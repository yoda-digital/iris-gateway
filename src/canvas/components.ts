export type CanvasComponent =
  | TextComponent
  | MarkdownComponent
  | FormComponent
  | ChartComponent
  | ImageComponent
  | TableComponent
  | CodeComponent
  | ButtonComponent
  | ProgressComponent;

export interface TextComponent {
  readonly type: "text";
  readonly id: string;
  readonly content: string;
}

export interface MarkdownComponent {
  readonly type: "markdown";
  readonly id: string;
  readonly content: string;
}

export interface FormComponent {
  readonly type: "form";
  readonly id: string;
  readonly fields: FormField[];
}

export interface FormField {
  readonly name: string;
  readonly type: "text" | "number" | "select" | "checkbox" | "textarea" | "slider";
  readonly label: string;
  readonly options?: string[];
  readonly min?: number;
  readonly max?: number;
  readonly required?: boolean;
  readonly value?: unknown;
}

export interface ChartComponent {
  readonly type: "chart";
  readonly id: string;
  readonly chartType: "bar" | "line" | "pie";
  readonly data: { labels: string[]; datasets: Array<{ label: string; data: number[]; color?: string }> };
}

export interface ImageComponent {
  readonly type: "image";
  readonly id: string;
  readonly url: string;
  readonly alt?: string;
}

export interface TableComponent {
  readonly type: "table";
  readonly id: string;
  readonly headers: string[];
  readonly rows: string[][];
}

export interface CodeComponent {
  readonly type: "code";
  readonly id: string;
  readonly language: string;
  readonly content: string;
}

export interface ButtonComponent {
  readonly type: "button";
  readonly id: string;
  readonly label: string;
  readonly action: string;
}

export interface ProgressComponent {
  readonly type: "progress";
  readonly id: string;
  readonly value: number;
  readonly max: number;
  readonly label?: string;
}
