// frappe-gantt ships no TypeScript declarations — minimal shim for the
// subset of its API this app uses.
declare module 'frappe-gantt' {
  export interface GanttTask {
    id: string
    name: string
    start: string
    end: string
    progress?: number
    dependencies?: string
  }

  export interface GanttOptions {
    view_mode?: 'Hour' | 'Quarter Day' | 'Half Day' | 'Day' | 'Week' | 'Month' | 'Year'
    today_button?: boolean
    readonly?: boolean
    [key: string]: unknown
  }

  export default class Gantt {
    constructor(wrapper: string | HTMLElement | SVGElement, tasks: GanttTask[], options?: GanttOptions)
    refresh(tasks: GanttTask[]): void
  }
}
