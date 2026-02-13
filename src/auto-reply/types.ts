export interface AutoReplyTemplate {
  readonly id: string;
  readonly trigger: TemplateTrigger;
  readonly response: string;
  readonly priority?: number;
  readonly cooldown?: number;
  readonly once?: boolean;
  readonly channels?: string[];
  readonly chatTypes?: ("dm" | "group")[];
  readonly forwardToAi?: boolean;
}

export type TemplateTrigger =
  | { readonly type: "exact"; readonly pattern: string }
  | { readonly type: "regex"; readonly pattern: string }
  | { readonly type: "keyword"; readonly words: string[] }
  | { readonly type: "command"; readonly name: string }
  | { readonly type: "schedule"; readonly when: ScheduleCondition };

export interface ScheduleCondition {
  readonly hours?: [number, number];
  readonly days?: number[];
  readonly timezone?: string;
}

export interface TemplateMatch {
  readonly template: AutoReplyTemplate;
  readonly response: string;
}
