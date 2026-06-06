import { getRespondentSession } from "../../../src/api";
import { RespondentInterview } from "../../../src/components/RespondentInterview";

export default async function RespondentPage({
  params
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await getRespondentSession(sessionId);

  return <RespondentInterview initialSession={session} />;
}
