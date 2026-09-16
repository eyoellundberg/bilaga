import { RequestUpload } from './request-upload';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Upload requested files — Bilaga', robots: { index: false, follow: false } };
export default async function FileRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestUpload id={id} />;
}
