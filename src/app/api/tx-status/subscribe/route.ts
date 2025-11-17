import { NextRequest } from "next/server";
import { addSubscriber, watchSignature } from "@/lib/txWatcher";

export async function GET(request: NextRequest) {
  const signature = request.nextUrl.searchParams.get("signature");
  if (!signature) {
    return new Response("signature required", { status: 400 });
  }

  watchSignature(signature);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: { status: string; error?: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const unsubscribe = addSubscriber(signature, (payload) => {
        send(payload);
        if (payload.status !== "pending") {
          controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
          controller.close();
        }
      });

      const abortHandler = () => {
        unsubscribe();
        controller.close();
      };

      request.signal.addEventListener("abort", abortHandler);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

