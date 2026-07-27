import { CredentialViewer } from "@/components/credential-viewer";

// Public page (link is the secret). No auth so the emailed recipient can open
// it directly; the token is single-use and expires.
export default async function CredentialsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CredentialViewer token={token} />;
}
