/**
 * Prometheus-compatible metrics export for production monitoring
 */

export interface MetricValue {
	value: number;
	labels?: Record<string, string>;
}

export interface Histogram {
	sum: number;
	count: number;
	buckets: Map<number, number>; // bucket upper bound -> count
}

/**
 * Metrics collector with Prometheus export format
 */
export class MetricsCollector {
	private counters: Map<string, number> = new Map();
	private gauges: Map<string, number> = new Map();
	private histograms: Map<string, Histogram> = new Map();
	private labels: Map<string, Record<string, string>> = new Map();

	/**
	 * Increment a counter metric
	 */
	incrementCounter(name: string, labels?: Record<string, string>, value: number = 1): void {
		const key = this.getKey(name, labels);
		const current = this.counters.get(key) || 0;
		this.counters.set(key, current + value);
		if (labels) {
			this.labels.set(key, labels);
		}
	}

	/**
	 * Set a gauge metric
	 */
	setGauge(name: string, value: number, labels?: Record<string, string>): void {
		const key = this.getKey(name, labels);
		this.gauges.set(key, value);
		if (labels) {
			this.labels.set(key, labels);
		}
	}

	/**
	 * Observe a value in a histogram
	 */
	observeHistogram(name: string, value: number, labels?: Record<string, string>, buckets: number[] = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120]): void {
		const key = this.getKey(name, labels);
		let histogram = this.histograms.get(key);
		
		if (!histogram) {
			histogram = {
				sum: 0,
				count: 0,
				buckets: new Map(buckets.map(b => [b, 0])),
			};
			this.histograms.set(key, histogram);
		}

		histogram.sum += value;
		histogram.count += 1;

		// Increment bucket counts
		for (const [bucket, count] of histogram.buckets.entries()) {
			if (value <= bucket) {
				histogram.buckets.set(bucket, count + 1);
			}
		}

		if (labels) {
			this.labels.set(key, labels);
		}
	}

	/**
	 * Generate key from metric name and labels
	 */
	private getKey(name: string, labels?: Record<string, string>): string {
		if (!labels || Object.keys(labels).length === 0) {
			return name;
		}
		const labelStr = Object.entries(labels)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}="${v}"`)
			.join(',');
		return `${name}{${labelStr}}`;
	}

	/**
	 * Export metrics in Prometheus text format
	 */
	exportPrometheus(): string {
		const lines: string[] = [];
		const seenTypes = new Set<string>();

		// Export counters
		for (const [key, value] of this.counters.entries()) {
			const metricName = this.getMetricName(key);
			if (!seenTypes.has(metricName)) {
				lines.push(`# TYPE ${metricName} counter`);
				seenTypes.add(metricName);
			}
			lines.push(`${key} ${value}`);
		}

		// Export gauges
		for (const [key, value] of this.gauges.entries()) {
			const metricName = this.getMetricName(key);
			if (!seenTypes.has(metricName)) {
				lines.push(`# TYPE ${metricName} gauge`);
				seenTypes.add(metricName);
			}
			lines.push(`${key} ${value}`);
		}

		// Export histograms
		for (const [key, histogram] of this.histograms.entries()) {
			const metricName = this.getMetricName(key);
			if (!seenTypes.has(metricName)) {
				lines.push(`# TYPE ${metricName} histogram`);
				seenTypes.add(metricName);
			}
			
			// Export buckets
			for (const [bucket, count] of histogram.buckets.entries()) {
				const bucketKey = key.includes('{') 
					? key.replace('}', `,le="${bucket}"}`)
					: `${key}{le="${bucket}"}`;
				lines.push(`${metricName}_bucket${bucketKey.substring(metricName.length)} ${count}`);
			}
			
			// Export sum and count
			lines.push(`${metricName}_sum${key.substring(metricName.length)} ${histogram.sum}`);
			lines.push(`${metricName}_count${key.substring(metricName.length)} ${histogram.count}`);
		}

		return lines.join('\n') + '\n';
	}

	/**
	 * Export metrics as JSON
	 */
	exportJSON(): Record<string, any> {
		return {
			counters: Object.fromEntries(this.counters),
			gauges: Object.fromEntries(this.gauges),
			histograms: Object.fromEntries(
				Array.from(this.histograms.entries()).map(([key, hist]) => [
					key,
					{
						sum: hist.sum,
						count: hist.count,
						buckets: Object.fromEntries(hist.buckets),
					},
				])
			),
		};
	}

	/**
	 * Calculate percentile from histogram
	 */
	calculatePercentile(name: string, percentile: number, labels?: Record<string, string>): number | null {
		const key = this.getKey(name, labels);
		const histogram = this.histograms.get(key);
		
		if (!histogram || histogram.count === 0) {
			return null;
		}

		const targetCount = Math.ceil(histogram.count * percentile);
		let cumulativeCount = 0;

		const sortedBuckets = Array.from(histogram.buckets.entries()).sort(([a], [b]) => a - b);
		
		for (const [bucket, count] of sortedBuckets) {
			cumulativeCount += count;
			if (cumulativeCount >= targetCount) {
				return bucket;
			}
		}

		return sortedBuckets[sortedBuckets.length - 1][0];
	}

	/**
	 * Get metric name without labels
	 */
	private getMetricName(key: string): string {
		const bracketIndex = key.indexOf('{');
		return bracketIndex > 0 ? key.substring(0, bracketIndex) : key;
	}

	/**
	 * Reset all metrics
	 */
	reset(): void {
		this.counters.clear();
		this.gauges.clear();
		this.histograms.clear();
		this.labels.clear();
	}
}

/**
 * Global metrics instance
 */
export const metrics = new MetricsCollector();

/**
 * Key metrics for lexrunner operations
 */
export const METRICS = {
	// Execution metrics
	PLAN_EXECUTION_TIME: 'lex_pr_plan_execution_seconds',
	GATE_EXECUTION_TIME: 'lex_pr_gate_execution_seconds',
	MERGE_EXECUTION_TIME: 'lex_pr_merge_execution_seconds',
	
	// Success/failure rates
	GATE_SUCCESS_TOTAL: 'lex_pr_gate_success_total',
	GATE_FAILURE_TOTAL: 'lex_pr_gate_failure_total',
	MERGE_SUCCESS_TOTAL: 'lex_pr_merge_success_total',
	MERGE_FAILURE_TOTAL: 'lex_pr_merge_failure_total',
	
	// Resource utilization
	MEMORY_USAGE_BYTES: 'lex_pr_memory_usage_bytes',
	ACTIVE_WORKERS: 'lex_pr_active_workers',
	
	// Dependency resolution
	DEPENDENCY_RESOLUTION_TIME: 'lex_pr_dependency_resolution_seconds',
	DEPENDENCY_ACCURACY: 'lex_pr_dependency_accuracy_ratio',
} as const;
