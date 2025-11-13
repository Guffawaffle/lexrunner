import { z } from "zod";
/**
 * Safety Gates Configuration Schema
 * Corresponds to gates.schema.json
 */
declare const GateItemSchema: z.ZodObject<
	{
		id: z.ZodString;
		type: z.ZodEnum<{
			check: "check";
			validation: "validation";
			approval: "approval";
		}>;
		enabled: z.ZodBoolean;
		description: z.ZodOptional<z.ZodString>;
		config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
	},
	z.core.$strict
>;
export declare const GatesSchema: z.ZodObject<
	{
		version: z.ZodOptional<z.ZodString>;
		gates: z.ZodOptional<
			z.ZodArray<
				z.ZodObject<
					{
						id: z.ZodString;
						type: z.ZodEnum<{
							check: "check";
							validation: "validation";
							approval: "approval";
						}>;
						enabled: z.ZodBoolean;
						description: z.ZodOptional<z.ZodString>;
						config: z.ZodOptional<
							z.ZodRecord<z.ZodString, z.ZodUnknown>
						>;
					},
					z.core.$strict
				>
			>
		>;
	},
	z.core.$strict
>;
export type Gates = z.infer<typeof GatesSchema>;
export type GateItem = z.infer<typeof GateItemSchema>;
export {};
