const mediasoup = require("mediasoup");
const fs = require("fs");
const https = require("https");
const express = require("express");
const socketIO = require("socket.io");
const config = require("./config");

// Global variables
let worker;
let webServer;
let socketServer;
let expressApp;
let mediasoupRouter;

let producers = new Map();

(async () => {
  try {
    await runExpressApp();
    await runWebServer();
    await runSocketServer();
    await runMediasoupWorker();
  } catch (err) {
    console.error(err);
  }
})();

async function runExpressApp() {
  expressApp = express();
  expressApp.use(express.json());
  expressApp.use(express.static(__dirname));

  expressApp.use((error, req, res, next) => {
    if (error) {
      console.warn("Express app error,", error.message);

      error.status = error.status || (error.name === "TypeError" ? 400 : 500);

      res.statusMessage = error.message;
      res.status(error.status).send(String(error));
    } else {
      next();
    }
  });
}

async function runWebServer() {
  const { sslKey, sslCrt } = config;
  if (!fs.existsSync(sslKey) || !fs.existsSync(sslCrt)) {
    console.error("SSL files are not found. check your config.js file");
    process.exit(0);
  }
  const tls = {
    cert: fs.readFileSync(sslCrt),
    key: fs.readFileSync(sslKey),
  };
  webServer = https.createServer(tls, expressApp);
  webServer.on("error", (err) => {
    console.error("starting web server failed:", err.message);
  });

  await new Promise((resolve) => {
    const { listenIp, listenPort, path } = config;
    webServer.listen(listenPort, listenIp, () => {
      const listenIps = config.mediasoup.webRtcTransport.listenIps[0];
      const ip = listenIps.announcedIp || listenIps.ip;
      console.log(`server is running on ${ip}:${listenPort}${path}`);
      resolve();
    });
  });
}

async function runSocketServer() {
  const { path } = config;
  socketServer = socketIO(webServer, {
    serveClient: false,
    path,
    log: true,
  });

  socketServer.on("connection", (socket) => {
    console.log("client connected on ", socket.handshake.address);
    let consumerTransport;
    let consumer;


    async function createConsumer(id, producer, rtpCapabilities) {
      if (
        !mediasoupRouter.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        console.error("can not consume", producer.id, rtpCapabilities);
        return;
      }
      try {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: producer.kind === "video",
        });
        let config = producers.get(id);
        if (!config) {
          config = {}
          producers.set(id, config);
        }
        config.consumer = consumer;
      } catch (error) {
        console.error("consume failed", error);
        return;
      }

      if (consumer.type === "simulcast") {
        await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
      }

      return {
        producerId: producer.id,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
      };
    }


    socket.resources = {
      screen: false,
      video: true,
      audio: false,
    };

    socket.on("message", function (message) {
      console.log("new message: ", message);
    });

    for (const [id,] of producers.entries()) {
      console.log('emit new producer', id);
      socket.emit('newProducer', { id });
    }

    socket.on("disconnect", () => {
      console.log("client disconnected");
    });

    socket.on("connect_error", (err) => {
      console.error("client connection error", err);
    });

    socket.on("getRouterRtpCapabilities", (data, callback) => {
      console.log("getRouterRtpCapabilities");
      callback(mediasoupRouter.rtpCapabilities);
    });

    socket.on("createProducerTransport", async (data, callback) => {
      console.log("createProducerTransport", data);
      let { id } = data;
      let producer = producers.get(id);
      if (!producer) {
        producer = {}
        producers.set(id, producer);
      }
      try {
        const { transport, params } = await createWebRtcTransport();
        producer.transport = transport;
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on("createConsumerTransport", async (data, callback) => {
      console.log("createConsumerTransport", data, callback);
      try {
        const { transport, params } = await createWebRtcTransport();
        consumerTransport = transport;
        callback(params);
      } catch (err) {
        console.error(err);
        callback({ error: err.message });
      }
    });

    socket.on("connectProducerTransport", async (data, callback) => {
      console.log("connectProducerTransport", data, callback);
      let { id } = data;
      let producerTransport = producers.get(id).transport;
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on("connectConsumerTransport", async (data, callback) => {
      console.log("connectConsumerTransport !!!", data, callback);
      if (consumerTransport) {
        await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      } else {
        console.error("no consumer transport!");
      }
      callback();
    });

    socket.on("produce", async (data, callback) => {
      console.log("produce");
      const { id, kind, rtpParameters } = data;
      const producerConfig = producers.get(id);
      const producerTransport = producerConfig.transport;
      const producer = await producerTransport.produce({ kind, rtpParameters });
      producerConfig.producer = producer;
      callback({ id: producer.id });

      // inform clients about new producer
      console.log('create producer', id, producer.id);
      console.log('emit new producer', id);
      socket.broadcast.emit("newProducer", { id });
    });

    socket.on("consume", async (data, callback) => {
      console.log("consume", data);
      let { id } = data;
      let producer = producers.get(id).producer;
      if (producer) {
        callback(await createConsumer(id, producer, data.rtpCapabilities));
      }
    });

    socket.on("resume", async (data, callback) => {
      await consumer.resume();
      callback();
    });
  });
}

async function runMediasoupWorker() {
  console.log("creating mediasoup worker");

  worker = await mediasoup.createWorker({
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  });

  worker.on("died", () => {
    console.error(
      "mediasoup worker died, exiting in 2 seconds... [pid:%d]",
      worker.pid
    );
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs = config.mediasoup.router.mediaCodecs;
  mediasoupRouter = await worker.createRouter({ mediaCodecs });

  console.log("mediasoup router created in worker");
}

async function createWebRtcTransport() {
  const { maxIncomingBitrate, initialAvailableOutgoingBitrate } =
    config.mediasoup.webRtcTransport;

  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate,
  });
  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) { }
  }
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}
