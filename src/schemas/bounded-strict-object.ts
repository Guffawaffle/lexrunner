import { z } from "zod";

export function boundedStrictObject<const Shape extends z.ZodRawShape>(shape: Shape) {
  const allowedKeys = new Set(Object.keys(shape));
  return z.preprocess((input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return input;
    }
    try {
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        return null;
      }
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !allowedKeys.has(key)) {
          return null;
        }
      }
    } catch {
      return null;
    }
    return input;
  }, z.object(shape));
}
