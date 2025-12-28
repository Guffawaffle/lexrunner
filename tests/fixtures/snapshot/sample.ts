// Sample TypeScript file for snapshot testing
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

// This line has a bug
export function divide(a: number, b: number): number {
  return a / b; // Should check for division by zero
}

export function subtract(a: number, b: number): number {
  return a - b;
}
