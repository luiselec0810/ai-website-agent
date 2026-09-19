/**
 * Tests del Approval Gate.
 * SRS §3.2 — human-in-the-loop obligatorio.
 */

import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../../src/executor/approval-gate.js';

describe('ApprovalGate', () => {
  describe('read-only tools', () => {
    it('allows list_pages regardless of status', () => {
      for (const status of ['draft', 'awaiting_approval', 'completed', 'rolled_back']) {
        const gate = new ApprovalGate(status);
        expect(gate.canExecute('list_pages')).toBe(true);
      }
    });

    it('allows get_elementor_structure in any status', () => {
      const gate = new ApprovalGate('draft');
      expect(gate.canExecute('get_elementor_structure')).toBe(true);
    });

    it('allows search_media', () => {
      const gate = new ApprovalGate('draft');
      expect(gate.canExecute('search_media')).toBe(true);
    });
  });

  describe('write tools', () => {
    it('blocks update_widget if status is awaiting_approval', () => {
      const gate = new ApprovalGate('awaiting_approval');
      expect(gate.canExecute('update_widget')).toBe(false);
      expect(() => gate.requireApproval('update_widget')).toThrow(
        /cannot be executed.*require status "approved"/
      );
    });

    it('blocks add_widget if status is draft', () => {
      const gate = new ApprovalGate('draft');
      expect(gate.canExecute('add_widget')).toBe(false);
    });

    it('allows update_widget if status is approved', () => {
      const gate = new ApprovalGate('approved');
      expect(gate.canExecute('update_widget')).toBe(true);
    });

    it('allows update_widget if status is executing', () => {
      const gate = new ApprovalGate('executing');
      expect(gate.canExecute('update_widget')).toBe(true);
    });

    it('blocks create_page in any status except approved/executing', () => {
      expect(new ApprovalGate('draft').canExecute('create_page')).toBe(false);
      expect(new ApprovalGate('approved').canExecute('create_page')).toBe(true);
    });
  });

  describe('unknown tools', () => {
    it('denies unknown tool regardless of status', () => {
      const gate = new ApprovalGate('approved');
      expect(gate.canExecute('execute_arbitrary_php')).toBe(false);
    });
  });
});
