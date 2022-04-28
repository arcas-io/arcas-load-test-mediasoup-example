import { Session } from "@arcas/sdk";
import { deviceLoaded, createProducerTransport } from "./signaling.js";

const LOAD_TEST_COUNT = 10;
const TEST_SOAK_TIME_S = 10;
const SOCKET_URI = "https://127.0.0.1:3000";
const SERVERS = ["[::1]:50051"];

// create the session
const session = await Session.create({
  name: "First Session",
  servers: SERVERS,
  protoPath: "/proto/webrtc.proto",
  logLevel: "NONE",
  pollingStateS: 1,
});

// start the session
await session.start();

// wait for the device to load
await deviceLoaded(SOCKET_URI, async (device) => {
  const TEST_INTERVAL_S = 1;
  let TEST_COUNTER_S = 0;

  // create LOAD_TEST_COUNT producer transports
  for (let i = 0; i < LOAD_TEST_COUNT; i++) {
    await createProducerTransport(device);
  }

  const interval = setInterval(async () => {
    TEST_COUNTER_S += TEST_INTERVAL_S;

    const stats = await session.getStats();
    const num_sending = stats.session.peer_connection_state.num_sending;
    const elapsed_time = stats.session.elapsed_time;
    console.log(
      `num_sending: ${num_sending}, elapsed_time: ${elapsed_time} seconds`
    );

    if (TEST_COUNTER_S >= TEST_SOAK_TIME_S) {
      clearInterval(interval);
      await session.stop();
      process.exit();
    }
  }, TEST_INTERVAL_S * 1000);
});
