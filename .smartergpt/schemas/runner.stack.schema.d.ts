import { z } from "zod";
/**
 * Runner Stack Configuration Schema
 * Corresponds to runner.stack.schema.json
 */
declare const StackComponentSchema: z.ZodObject<
	{
		name: z.ZodString;
		type: z.ZodString;
		enabled: z.ZodOptional<z.ZodBoolean>;
		config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
	},
	z.core.$strict
>;
export declare const RunnerStackSchema: z.ZodObject<
	{
		version: z.ZodOptional<z.ZodString>;
		stack: z.ZodOptional<
			z.ZodArray<
				z.ZodObject<
					{
						name: z.ZodString;
						type: z.ZodString;
						enabled: z.ZodOptional<z.ZodBoolean>;
						config: z.ZodOptional<
							z.ZodRecord<z.ZodString, z.ZodUnknown>
						>;
					},
					z.core.$strict
				>
			>
		>;
		timeout: z.ZodOptional<z.ZodNumber>;
		retries: z.ZodOptional<z.ZodNumber>;
	},
	z.core.$strict
>;
export type RunnerStack = z.infer<typeof RunnerStackSchema>;
export type StackComponent = z.infer<typeof StackComponentSchema>;
export {};
