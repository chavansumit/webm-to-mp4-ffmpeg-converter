export function onRequest() {
    return Response.json({ native: false }, { status: 503 });
}
