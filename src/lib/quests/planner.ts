import type { Settings } from '@/types';
import { aiConfig, isAiConfigured, runStructuredLLM, timeContext } from '@/lib/ai/providers';
import { validateSteps, type QuestStepDraft } from './model';

export async function planLifeGoal(title: string, description: string, budget: number, settings: Settings, signal?: AbortSignal): Promise<QuestStepDraft[]> {
  const config = aiConfig(settings);
  if (!isAiConfigured(config)) throw new Error('quest.configureAi');
  const result = await runStructuredLLM<{ steps: QuestStepDraft[] }>(config, 'auto', {
    signal,
    system: `你是生活成长游戏的任务规划师。根据用户的真实目标生成一条有限、可完成的行动路线。只输出 JSON {"steps":[{"key":"s1","title":"可执行任务","acceptance":"具体完成标准","minutes":25,"requires":[]}]}。
生成 3 到 20 项，必要时最多 30 项，每项预计 5 到 ${budget} 分钟，必须为整数。过大的工作拆成可在一天完成的小步骤。
前置关系通过 requires 引用 key，必须无环；后置技能必须以前置成果为基础，不能直接跳到最终成果。支持合理并行，但不要所有任务都无依赖。key 只使用字母数字下划线。
结合现有基础和设备条件，不编造用户已有的知识和成果，不编造未提供的教材章节。信息不足时先安排一个具体的现状梳理任务。
这是一轮有限路线，学习/开发目标用明确验收的成果推进，不安排模糊的“继续学习”任务。运动等重复目标拆成有不同日期阶段含义的步骤。不要输出金币、经验或建议用户兑换奖励。输出语言与用户一致。`,
    user: `${timeContext()}\n目标：${title}\n当前基础、完成标准和条件：${description}\n每天可用 ${budget} 分钟。`,
  }, { steps: 'array' }, undefined, 60_000);
  if (result.status !== 'ok') throw new Error(result.status === 'error' ? result.message : 'quest.planFailed');
  const steps = result.data.steps;
  if (!steps.every(s => s && typeof s.key === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(s.key) && typeof s.title === 'string' && typeof s.acceptance === 'string' && Array.isArray(s.requires) && s.requires.every(p => typeof p === 'string'))) throw new Error('quest.invalidPlan');
  validateSteps(steps, budget);
  return steps;
}
