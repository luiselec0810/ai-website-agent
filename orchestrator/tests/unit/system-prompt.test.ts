/**
 * Tests del system prompt.
 * SRS §30 — el prompt debe establecer principios, restricciones y formato.
 */

import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from '../../src/planner/system-prompt.js';

describe('System Prompt (SRS §30)', () => {
  it('requires the agent to use tools', () => {
    expect(SYSTEM_PROMPT).toContain('controlled tools');
  });

  it('prohibits direct database modification', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('never modify wordpress directly');
  });

  it('requires inspection before modification', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('always inspect');
  });

  it('prohibits publishing without approval', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('do not publish');
  });

  it('requires change plan for complex modifications', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('change plan');
  });

  it('prohibits arbitrary code execution', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('never execute arbitrary code');
  });

  it('prohibits exposing credentials', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('never expose credentials');
  });

  it('instructs the agent to prefer templates and global styles', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('global styles');
  });

  it('asks the agent to ask for clarification when ambiguous', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('ask for clarification');
  });

  it('instructs the agent not to reuse stale IDs from get_template after use_template', () => {
    // Regresión: cuando el LLM usaba IDs hardcoded del template original
    // después de un use_template, esos IDs ya no existían en la página
    // clonada. El prompt debe advertir explícitamente y ofrecer el
    // placeholder indexado {{element_id:N}}.
    expect(SYSTEM_PROMPT).toContain('new_element_ids');
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('stale');
    expect(SYSTEM_PROMPT).toContain('{{element_id:0}}');
    expect(SYSTEM_PROMPT).toContain('{{element_id:1}}');
  });
});
