export class CallBudget {
  private used = 0;

  constructor(private readonly maxCalls: number) {}

  reserve(): boolean {
    if (this.used >= this.maxCalls) return false;
    this.used += 1;
    return true;
  }

  get count(): number {
    return this.used;
  }
}
