import { z } from "zod";
/**
 * Runner Scope Configuration Schema
 * Corresponds to runner.scope.schema.json
 */
declare const ScopeBoundariesSchema: z.ZodObject<
	{
		modules: z.ZodOptional<z.ZodArray<z.ZodString>>;
		directories: z.ZodOptional<z.ZodArray<z.ZodString>>;
		files: z.ZodOptional<z.ZodArray<z.ZodString>>;
		exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
	},
	z.core.$strict
>;
declare const ResourceLimitsSchema: z.ZodObject<
	{
		maxFiles: z.ZodOptional<z.ZodNumber>;
		maxLines: z.ZodOptional<z.ZodNumber>;
		maxDuration: z.ZodOptional<z.ZodNumber>;
	},
	z.core.$strict
>;
export declare const RunnerScopeSchema: z.ZodObject<
	{
		version: z.ZodOptional<z.ZodString>;
		scope: z.ZodOptional<
			z.ZodObject<
				{
					modules: z.ZodOptional<z.ZodArray<z.ZodString>>;
					directories: z.ZodOptional<z.ZodArray<z.ZodString>>;
					files: z.ZodOptional<z.ZodArray<z.ZodString>>;
					exclude: z.ZodOptional<z.ZodArray<z.ZodString>>;
				},
				z.core.$strict
			>
		>;
		permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
		limits: z.ZodOptional<
			z.ZodObject<
				{
					maxFiles: z.ZodOptional<z.ZodNumber>;
					maxLines: z.ZodOptional<z.ZodNumber>;
					maxDuration: z.ZodOptional<z.ZodNumber>;
				},
				z.core.$strict
			>
		>;
	},
	z.core.$strict
>;
export type RunnerScope = z.infer<typeof RunnerScopeSchema>;
export type ScopeBoundaries = z.infer<typeof ScopeBoundariesSchema>;
export type ResourceLimits = z.infer<typeof ResourceLimitsSchema>;
export {};
