import { proxyActivities } from '@temporalio/workflow';
import type { BackgroundJob } from '@factory/platform';

const activities = proxyActivities<{processNote: (job: BackgroundJob) => Promise<void>}>({startToCloseTimeout:'30 seconds',retry:{maximumAttempts:5}});
/** Temporal workflow contains only deterministic orchestration; Effect services execute in activities. */
export async function processNoteWorkflow(job: BackgroundJob): Promise<void> { await activities.processNote(job); }
