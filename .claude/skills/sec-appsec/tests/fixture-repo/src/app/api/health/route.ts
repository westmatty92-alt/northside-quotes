// FIXTURE. Public health check: nothing here may be flagged.
export async function GET() {
  return Response.json({ ok: true });
}
