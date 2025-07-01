import { DebugUpload } from '@/components/debug-upload';

export default function DebugUploadPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Upload Debug Page</h1>
      <p className="text-gray-600 mb-6">
        This page helps debug document upload issues. Use the buttons below to test different upload endpoints.
      </p>
      <DebugUpload />
    </div>
  );
}