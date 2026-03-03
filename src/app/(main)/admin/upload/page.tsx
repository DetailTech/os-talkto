import { UploadForm } from "@/components/upload-form";
import { TranscriptPipelineForm } from "@/components/transcript-pipeline-form";
import { requireAdmin } from "@/lib/auth/server";
import { listOraclePersonasBasic } from "@/lib/db/oracle";

export const dynamic = "force-dynamic";

export default async function AdminUploadPage() {
  await requireAdmin();
  const personas = await listOraclePersonasBasic();

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Upload Documents</h1>
          <p className="text-muted-foreground mt-1">
            Upload PDF or text transcripts to feed the persona&apos;s knowledge base. Documents are
            chunked, embedded, and stored for RAG retrieval.
          </p>
        </div>
        <TranscriptPipelineForm
          personas={personas}
        />
        <UploadForm personas={personas} />
      </div>
    </div>
  );
}
