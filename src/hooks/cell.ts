// A value that is read and replaced from callbacks and effects, never during render: what a ref is for, as a plain
// object made once with `useState(() => new Cell(...))[0]`. It exists so a latest-value holder can be handed to a function
// (a token reader, a callback registered later) without the lint rule that forbids passing a React ref around.
export class Cell<T> {
  private value: T;

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(next: T): void {
    this.value = next;
  }
}
