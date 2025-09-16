import { setTimeout as setTimeoutPromise } from "node:timers/promises";

export const GET = async (req: Request) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "signal";
  const duration = parseInt(url.searchParams.get("duration") || "5000");

  console.log(`Starting ${mode} mode request for ${duration}ms`);

  try {
    switch (mode) {
      case "signal":
        return await handleSignalMode(req, duration);
      case "stream":
        return await handleStreamMode(req, duration);
      case "heartbeat":
        return await handleHeartbeatMode(req, duration);
      case "chunked":
        return await handleChunkedMode(req, duration);
      default:
        return new Response("Invalid mode", { status: 400 });
    }
  } catch (error) {
    console.error("API Error:", error);
    return new Response("Internal server error", { status: 500 });
  }
};

// Method 1: Using AbortSignal with setTimeoutPromise (Recommended)
async function handleSignalMode(req: Request, duration: number) {
  try {
    console.log("Signal mode: Starting delay...");
    await setTimeoutPromise(duration, undefined, { signal: req.signal });

    console.log("Signal mode: Delay completed");
    return new Response(
      JSON.stringify({
        mode: "signal",
        message: `Completed after ${duration}ms using AbortSignal`,
        timestamp: new Date().toISOString(),
        duration,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.log("Signal mode: Request was aborted");
      return new Response("Request was aborted", { status: 499 });
    }
    throw error;
  }
}

// Method 2: Streaming with periodic writes
async function handleStreamMode(req: Request, duration: number) {
  const encoder = new TextEncoder();
  const intervalMs = Math.min(1000, duration / 5); // Update 5 times or every second

  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log("Stream mode: Starting...");
        let elapsed = 0;

        // Send initial message
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "start",
              message: "Starting delayed operation...",
              timestamp: new Date().toISOString(),
            }) + "\n",
          ),
        );

        // Send periodic updates
        while (elapsed < duration) {
          const waitTime = Math.min(intervalMs, duration - elapsed);
          await setTimeoutPromise(waitTime, undefined, { signal: req.signal });
          elapsed += waitTime;

          try {
            const progress = Math.round((elapsed / duration) * 100);
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "progress",
                  progress,
                  elapsed,
                  duration,
                  timestamp: new Date().toISOString(),
                }) + "\n",
              ),
            );
          } catch (writeError) {
            console.log("Stream mode: Client disconnected during write");
            controller.close();
            return;
          }
        }

        // Send completion message
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "complete",
              mode: "stream",
              message: `Completed after ${duration}ms using streaming`,
              timestamp: new Date().toISOString(),
              duration,
            }) + "\n",
          ),
        );

        console.log("Stream mode: Completed");
        controller.close();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          console.log("Stream mode: Request was aborted");
          controller.close();
        } else {
          console.error("Stream mode error:", error);
          controller.error(error);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson", // Newline-delimited JSON
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Method 3: Server-Sent Events with heartbeat
async function handleHeartbeatMode(req: Request, duration: number) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatInterval: NodeJS.Timeout | null = null; // Initialize as null

      try {
        console.log("Heartbeat mode: Starting...");

        // Send initial event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "start",
              message: "Starting with heartbeat monitoring...",
              timestamp: new Date().toISOString(),
            })}\n\n`,
          ),
        );

        // Start heartbeat to detect disconnections
        heartbeatInterval = setInterval(() => {
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "heartbeat",
                  timestamp: new Date().toISOString(),
                })}\n\n`,
              ),
            );
          } catch (error) {
            console.log("Heartbeat mode: Client disconnected during heartbeat");
            if (heartbeatInterval) {
              clearInterval(heartbeatInterval);
              heartbeatInterval = null;
            }
            controller.close();
          }
        }, 1000);

        // Main delay
        await setTimeoutPromise(duration, undefined, { signal: req.signal });

        // Clear heartbeat
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        // Send completion event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "complete",
              mode: "heartbeat",
              message: `Completed after ${duration}ms with heartbeat monitoring`,
              timestamp: new Date().toISOString(),
              duration,
            })}\n\n`,
          ),
        );

        console.log("Heartbeat mode: Completed");
        controller.close();
      } catch (error) {
        // Safe cleanup - check if heartbeatInterval was assigned
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        if (error instanceof Error && error.name === "AbortError") {
          console.log("Heartbeat mode: Request was aborted");
        } else {
          console.error("Heartbeat mode error:", error);
          controller.error(error);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Method 4: Chunked response with periodic connection checks
async function handleChunkedMode(req: Request, duration: number) {
  const encoder = new TextEncoder();
  const checkInterval = 500; // Check connection every 500ms

  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log("Chunked mode: Starting...");
        let elapsed = 0;

        // Send initial chunk
        controller.enqueue(
          encoder.encode(
            '{"status":"starting","message":"Beginning chunked response..."}\n',
          ),
        );

        while (elapsed < duration) {
          const waitTime = Math.min(checkInterval, duration - elapsed);
          await setTimeoutPromise(waitTime, undefined, { signal: req.signal });
          elapsed += waitTime;

          try {
            // Write a small chunk to test connection
            const progress = Math.round((elapsed / duration) * 100);
            controller.enqueue(
              encoder.encode(
                `{"status":"progress","progress":${progress},"elapsed":${elapsed}}\n`,
              ),
            );
          } catch (writeError) {
            console.log("Chunked mode: Client disconnected during write");
            controller.close();
            return;
          }
        }

        // Send final chunk
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              status: "complete",
              mode: "chunked",
              message: `Completed after ${duration}ms using chunked response`,
              timestamp: new Date().toISOString(),
              duration,
            }) + "\n",
          ),
        );

        console.log("Chunked mode: Completed");
        controller.close();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          console.log("Chunked mode: Request was aborted");
        } else {
          console.error("Chunked mode error:", error);
          controller.error(error);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    },
  });
}
