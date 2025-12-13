/**
 * Graph generator utilities for performance benchmarks
 * Creates deterministic test graphs of various sizes and patterns
 */

import type { Plan, PlanItem } from '../../../src/schema.js';

export interface GraphOptions {
  nodes: number;
  pattern: 'linear' | 'diamond' | 'parallel' | 'complex';
}

/**
 * Generate a deterministic graph for benchmarking
 */
export function generateGraph(options: GraphOptions): Plan {
  const { nodes, pattern } = options;
  
  switch (pattern) {
    case 'linear':
      return generateLinearGraph(nodes);
    case 'diamond':
      return generateDiamondGraph(nodes);
    case 'parallel':
      return generateParallelGraph(nodes);
    case 'complex':
      return generateComplexGraph(nodes);
    default:
      throw new Error(`Unknown pattern: ${pattern}`);
  }
}

/**
 * Generate linear dependency chain: A → B → C → ...
 */
function generateLinearGraph(nodes: number): Plan {
  const items: PlanItem[] = [];
  
  for (let i = 0; i < nodes; i++) {
    const name = `node-${String(i).padStart(4, '0')}`;
    const deps = i === 0 ? [] : [`node-${String(i - 1).padStart(4, '0')}`];
    
    items.push({
      name,
      deps,
      gates: []
    });
  }
  
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items
  };
}

/**
 * Generate diamond-like pattern with multiple layers
 * Uses a pyramid distribution where base layers have more nodes than top layers
 */
function generateDiamondGraph(nodes: number): Plan {
  const items: PlanItem[] = [];
  
  // Calculate layer distribution (pyramid shape)
  // Base layer has sqrt(nodes) items, top layer has 1
  const layers = Math.ceil(Math.sqrt(nodes));
  let nodeIndex = 0;
  
  for (let layer = 0; layer < layers && nodeIndex < nodes; layer++) {
    // Items in this layer (more at base, fewer at top)
    const itemsInLayer = Math.max(1, Math.ceil((nodes / layers) * (layers - layer) / layers));
    const actualItems = Math.min(itemsInLayer, nodes - nodeIndex);
    
    for (let i = 0; i < actualItems; i++) {
      const name = `node-${String(nodeIndex).padStart(4, '0')}`;
      
      // Dependencies: connect to previous layer items
      let deps: string[] = [];
      if (layer > 0) {
        // Calculate start position of previous layer
        // This determines which nodes from the previous layer this node depends on
        const prevLayerStart = calculatePreviousLayerStart(layer, layers, nodes, nodeIndex, actualItems);
        const depsCount = Math.min(2, nodeIndex); // Max 2 dependencies per node
        
        for (let d = 0; d < depsCount && prevLayerStart + d >= 0 && prevLayerStart + d < nodeIndex; d++) {
          deps.push(`node-${String(Math.max(0, prevLayerStart + d)).padStart(4, '0')}`);
        }
      }
      
      items.push({
        name,
        deps,
        gates: []
      });
      
      nodeIndex++;
    }
  }
  
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items
  };
}

/**
 * Calculate the starting index of the previous layer for dependency connections
 * Ensures nodes in upper layers connect to nodes in the layer below them
 */
function calculatePreviousLayerStart(
  layer: number,
  layers: number,
  nodes: number,
  nodeIndex: number,
  actualItems: number
): number {
  return nodeIndex - actualItems - Math.max(1, Math.ceil((nodes / layers) * (layers - layer + 1) / layers));
}

/**
 * Generate fully parallel graph (all independent)
 */
function generateParallelGraph(nodes: number): Plan {
  const items: PlanItem[] = [];
  
  for (let i = 0; i < nodes; i++) {
    const name = `node-${String(i).padStart(4, '0')}`;
    
    items.push({
      name,
      deps: [],
      gates: []
    });
  }
  
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items
  };
}

/**
 * Generate complex realistic graph with mixed dependencies
 * Deterministic pseudo-random pattern based on node index
 */
function generateComplexGraph(nodes: number): Plan {
  const items: PlanItem[] = [];
  
  for (let i = 0; i < nodes; i++) {
    const name = `node-${String(i).padStart(4, '0')}`;
    const deps: string[] = [];
    
    // Deterministic dependency generation
    // Each node depends on 0-3 previous nodes based on index pattern
    if (i > 0) {
      const depCount = (i * 7) % 4; // 0-3 dependencies
      
      for (let d = 0; d < depCount; d++) {
        // Use deterministic formula to select dependency
        const depIndex = Math.max(0, i - ((i * 11 + d * 13) % (i + 1)) - 1);
        if (depIndex < i) {
          const depName = `node-${String(depIndex).padStart(4, '0')}`;
          if (!deps.includes(depName)) {
            deps.push(depName);
          }
        }
      }
    }
    
    // Sort deps for determinism
    deps.sort();
    
    items.push({
      name,
      deps,
      gates: []
    });
  }
  
  return {
    schemaVersion: '1.0.0',
    target: 'main',
    items
  };
}
