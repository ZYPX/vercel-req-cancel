"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ApiMode = "signal" | "stream" | "heartbeat" | "chunked";

export default function DelayedApiDemo() {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | object | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [mode, setMode] = useState<ApiMode>("signal");
  const [duration, setDuration] = useState(5000);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const cleanupRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanupRequest;
  }, [cleanupRequest]);

  const handleApiCall = async () => {
    if (loading) return;

    cleanupRequest();
    const currentRequestId = ++requestIdRef.current;

    setLoading(true);
    setResponse(null);
    setError(null);
    setProgress(0);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const url = `/api/mock?mode=${mode}&duration=${duration}`;
      const res = await fetch(url, {
        signal: abortController.signal,
      });

      if (currentRequestId !== requestIdRef.current) {
        console.log("Request superseded, ignoring response");
        return;
      }

      if (abortController.signal.aborted) {
        return;
      }

      if (res.status === 499) {
        setError("Request was cancelled by server");
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      // Handle different response types
      if (mode === "signal") {
        // Standard JSON response
        const data = await res.json();
        if (
          currentRequestId === requestIdRef.current &&
          !abortController.signal.aborted
        ) {
          setResponse(data);
        }
      } else if (mode === "heartbeat") {
        // Server-Sent Events
        await handleSSEResponse(res, currentRequestId, abortController);
      } else {
        // Streaming/Chunked responses (NDJSON)
        await handleStreamResponse(res, currentRequestId, abortController);
      }
    } catch (err) {
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (err instanceof Error && err.name === "AbortError") {
        setError("Request was cancelled");
      } else {
        setError(err instanceof Error ? err.message : "An error occurred");
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  const handleSSEResponse = async (
    res: Response,
    currentRequestId: number,
    abortController: AbortController,
  ) => {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (
          done ||
          currentRequestId !== requestIdRef.current ||
          abortController.signal.aborted
        ) {
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);

              if (parsed.type === "complete") {
                setResponse(parsed);
              } else if (parsed.type === "progress") {
                setProgress(parsed.progress || 0);
              }
              // Ignore heartbeat messages
            } catch {
              // Invalid JSON, ignore
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  const handleStreamResponse = async (
    res: Response,
    currentRequestId: number,
    abortController: AbortController,
  ) => {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) return;

    try {
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (
          done ||
          currentRequestId !== requestIdRef.current ||
          abortController.signal.aborted
        ) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);

              if (data.status === "complete" || data.type === "complete") {
                setResponse(data);
              } else if (
                data.status === "progress" ||
                data.type === "progress"
              ) {
                setProgress(data.progress || 0);
              }
            } catch {
              // Invalid JSON, ignore
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  };

  const handleCancelRequest = () => {
    cleanupRequest();
    setLoading(false);
    setProgress(0);
    setError("Request cancelled by user");
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground">
            Advanced Delayed API Demo
          </h1>
          <p className="text-muted-foreground">
            Test different approaches to handle client disconnections during
            long operations
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              Choose the API mode and duration to test different disconnection
              detection methods
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Mode:</label>
                <Select
                  value={mode}
                  onValueChange={(value: ApiMode) => setMode(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="signal">
                      AbortSignal (Recommended)
                    </SelectItem>
                    <SelectItem value="stream">Streaming Progress</SelectItem>
                    <SelectItem value="heartbeat">
                      Server-Sent Events
                    </SelectItem>
                    <SelectItem value="chunked">Chunked Response</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Duration (ms):</label>
                <Select
                  value={duration.toString()}
                  onValueChange={(value) => setDuration(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3000">3 seconds</SelectItem>
                    <SelectItem value="5000">5 seconds</SelectItem>
                    <SelectItem value="10000">10 seconds</SelectItem>
                    <SelectItem value="30000">30 seconds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleApiCall}
                disabled={loading}
                className="flex-1"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {mode === "signal"
                      ? `Waiting... (${duration / 1000}s)`
                      : `Processing... ${progress}%`}
                  </>
                ) : (
                  `Call ${mode.toUpperCase()} API`
                )}
              </Button>
              {loading && (
                <Button
                  onClick={handleCancelRequest}
                  variant="outline"
                  size="icon"
                  className="shrink-0 bg-transparent"
                  title="Cancel request"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {loading && progress > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {response && (
              <Card className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                <CardHeader>
                  <CardTitle className="text-green-800 dark:text-green-200">
                    Success!
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm text-green-700 dark:text-green-300 whitespace-pre-wrap">
                    {typeof response === "string"
                      ? response
                      : JSON.stringify(response, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}

            {error && (
              <Card className="bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800">
                <CardHeader>
                  <CardTitle className="text-red-800 dark:text-red-200">
                    Error
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-red-700 dark:text-red-300">{error}</p>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>

        <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="text-sm text-blue-800 dark:text-blue-200">
              Mode Explanations
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-blue-700 dark:text-blue-300">
            <div className="space-y-2">
              <p>
                <strong>AbortSignal:</strong> Uses Node.js setTimeoutPromise
                with signal for clean cancellation
              </p>
              <p>
                <strong>Streaming:</strong> Sends progress updates as NDJSON,
                detects disconnection on write
              </p>
              <p>
                <strong>Server-Sent Events:</strong> Uses SSE with heartbeat
                messages to monitor connection
              </p>
              <p>
                <strong>Chunked:</strong> Sends periodic chunks to test
                connection health during delay
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gray-50 dark:bg-gray-950 border-gray-200 dark:border-gray-800">
          <CardHeader>
            <CardTitle className="text-sm">Debug Info</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Request ID: {requestIdRef.current} | Loading: {loading.toString()}{" "}
              | Mode: {mode} | Progress: {progress}%
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
