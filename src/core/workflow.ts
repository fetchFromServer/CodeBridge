import * as vscode from 'vscode'
import { Logger } from './utils'

export interface WorkflowContext<TConfig = any> {
  config: TConfig
  logger: Logger
  token?: vscode.CancellationToken
  state: Record<string, any>
}

export interface IWorkflowStep<TCtx extends WorkflowContext> {
  name: string
  execute(ctx: TCtx): Promise<void>
}

export class WorkflowEngine<TCtx extends WorkflowContext> {
  private steps: (IWorkflowStep<TCtx> | ParallelGroup<TCtx>)[] = []

  constructor(private logger: Logger) {}

  public addStep(step: IWorkflowStep<TCtx>): this {
    this.steps.push(step)
    return this
  }

  public addParallel(name: string, ...steps: IWorkflowStep<TCtx>[]): this {
    this.steps.push(new ParallelGroup(name, steps))
    return this
  }

  public async run(context: TCtx): Promise<void> {
    for (const step of this.steps) {
      if (context.token?.isCancellationRequested) {
        this.logger.log('[Workflow] Cancelled by user.')
        break
      }

      try {
        await step.execute(context)
      } catch (e) {
        this.logger.error(`[Workflow] Step '${step.name}' failed`, e)
        throw e
      }
    }
  }
}

class ParallelGroup<TCtx extends WorkflowContext> implements IWorkflowStep<TCtx> {
  constructor(
    public name: string,
    private children: IWorkflowStep<TCtx>[],
  ) {}

  async execute(ctx: TCtx): Promise<void> {
    await Promise.all(this.children.map((child) => child.execute(ctx)))
  }
}
