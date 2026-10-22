export interface Command<T> { id: string; apply(state: T): T; revert(state: T): T; }
export class CommandStack<T> {
  private done: Command<T>[] = [];
  private undone: Command<T>[] = [];
  constructor(private state: T, private readonly limit = 200) {}
  value(): T { return this.state; }
  execute(command: Command<T>): T { this.state = command.apply(this.state); this.done.push(command); if (this.done.length > this.limit) this.done.shift(); this.undone = []; return this.state; }
  undo(): T { const command = this.done.pop(); if (!command) return this.state; this.state = command.revert(this.state); this.undone.push(command); return this.state; }
  redo(): T { const command = this.undone.pop(); if (!command) return this.state; this.state = command.apply(this.state); this.done.push(command); return this.state; }
  sizes(): { done: number; undone: number } { return { done: this.done.length, undone: this.undone.length }; }
}
