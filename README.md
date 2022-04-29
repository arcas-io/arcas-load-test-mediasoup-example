Arcas load testing depends on GStreamer version 1.18.X being installed on your computer. If you do not have GStreamer installed you can use the following links to download:

**NOTE**: Only GStreamer versions 1.18.X are compatible with this demo at this time.

- MacOS will need to install both of the following:
  - https://gstreamer.freedesktop.org/data/pkg/osx/1.18.6/gstreamer-1.0-1.18.6-x86_64.pkg
  - https://gstreamer.freedesktop.org/data/pkg/osx/1.18.6/gstreamer-1.0-devel-1.18.6-x86_64.pkg
  
  After installing both of those packages, please run the following commands in the terminal:
  ```
  mkdir -p /usr/local/opt/gst-plugins-base
  ln -s /Library/Frameworks/GStreamer.framework/Versions/1.0/lib /usr/local/opt/gst-plugins-base/lib
  mkdir -p /usr/local/opt/gstreamer
  ln -s /Library/Frameworks/GStreamer.framework/Versions/1.0/lib /usr/local/opt/gstreamer/lib
  ```

- Windows will need to install both of the following:
  - https://gstreamer.freedesktop.org/data/pkg/windows/1.18.6/msvc/gstreamer-1.0-msvc-x86-1.18.6.msi
  - https://gstreamer.freedesktop.org/data/pkg/windows/1.18.6/msvc/gstreamer-1.0-devel-msvc-x86-1.18.6.msi

- Linux - Please see the GStreamer installation [guide](https://gstreamer.freedesktop.org/documentation/installing/on-linux.html?gi-language=c)

To get a MediaSoup SFU up and running quickly, let's pull down some skeleton code from https://github.com/arcas-io/arcas-load-test-mediasoup-example.

```shell
git clone -b skeleton https://github.com/arcas-io/arcas-load-test-mediasoup-example.git
cd arcas-load-test-mediasoup-example/src
```

Let's start by creating an entry file:

```shell
touch index.js
```

Using your favorite editor, import the SDK and MediaSoup signaling code:

```js
import { Session } from "@arcas/sdk";
import { deviceLoaded, createProducerTransport } from "./signaling.js";
```

Now let's define some test defaults:

```js
const LOAD_TEST_COUNT = 100;
const TEST_SOAK_TIME_S = 10;
const SOCKET_URI = "https://127.0.0.1:3000";
const SERVERS = ["[::1]:50051"];
```

The `LOAD_TEST_COUNT` is the number of producers we want to create that will send video to the MediaSoup SFU.
The `TEST_SOAK_TIME_S` is the number of seconds to keep the test running.
The `SOCKET_URI` value is set in the `server/package.json` file in the `start` script.
The `SERVERS` value is set in the `package.json` file in the `server` script.  In future posts, I'll show you how
to scale the Arcas Load Test servers to increase the load test capacity.

In this test, we're configuring it to create 100 producers (peer connections) that will produce video in the
Arcas Load Test server for a total of 10 seconds.  Feel free to modify to test how much load the SFU can accommodate.

Using the `Session` class in the SDK, create the session:

```js
const session = await Session.create({
  name: "First Session",
  servers: SERVERS,
  protoPath: "/proto/webrtc.proto",
  logLevel: "NONE",
  pollingStateS: 1,
});
```

We're giving the session a name: `First Session`.  This will come in handy in later posts about using the Arcas Portal.
The other important session variable is `pollingStateS`.  This tells the Arcas Load Test server to poll the internals for
stats every `1` second.  You may want to increase this if scaling the Arcas Load Test servers.

We can now start the session to let the server know we're ready to start sending some load:

```js
await session.start();
```

The next step is to wait for the device to load before engaging the producers.
The remaining code creates `LOAD_TEST_COUNT` producer transports and holds the test for `TEST_SOAK_TIME_S` seconds.

```js
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
```

That's all the code you'll need to write for this test.
The next step is to install and start the MediaSoupSFU.
Before we install the server, ensure that you meet the requirements:

- https://mediasoup.org/documentation/v3/mediasoup/installation/#requirements


To install the server:

```shell
cd server && yarn
```

The installation may take several minutes downloading and compiling the MediaSoup source code.
Once that's done, start the MediaSoup SFU:

```shell
yarn start
```

You should see the output:

```
> mediasoup-server@0.1.2 start /arcas-load-test-mediasoup-example/server
> PORT=3000 WS_HOST=127.0.0.1 SERVER_HOST=0.0.0.0 node index.js

server is running on 127.0.0.1:3000/ws
creating mediasoup worker
mediasoup router created in worker
```

In a separate terminal window in the `/arcas-load-test-mediasoup-example` directory, start the Arcas Load Test server:

```shell
yarn && yarn server
```

With both the MediaSoup SFU and the Arcas Load Test server running, we can now start the test.
In a separate terminal window in the `/arcas-load-test-mediasoup-example` directory, kick off the test:

```shell
yarn start
```

You should see the test output:

```text
num_sending: 100, elapsed_time: 1
num_sending: 100, elapsed_time: 2
num_sending: 100, elapsed_time: 3
num_sending: 100, elapsed_time: 4
num_sending: 100, elapsed_time: 5
num_sending: 100, elapsed_time: 6
num_sending: 100, elapsed_time: 7
num_sending: 100, elapsed_time: 8
num_sending: 100, elapsed_time: 9
num_sending: 100, elapsed_time: 10
✨  Done in 10.96s.
```

Note: The first `num_sending` may be less than 100 as the service ramps up.

You can now stop the MediaSoup SFU and the Arcas Load Test server if you don't plan to run further tests.

That was easy, right?  We wrote some code to engage signaling of the MediaSoup SFU and started and created a session
in the Arcas Load Test server.  We then created producer peer connections that actually send video streams on the
Arcas Load Test server.

In future posts, I'll detail how monitor the SFU during the test.  Until then, happy testing!
