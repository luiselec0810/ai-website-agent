/**
 * Test del "smart fallback" en pickElementId.
 *
 * Bug del usuario 2026-09-17: el LLM usaba `{{element_id}}` (sin índice)
 * o placeholders malformados como `{{element}}` para apuntar a widgets
 * concretos. Mi código resolvía `{{element_id}}` → `lastContainerId`
 * que tras `use_template` es el ID del **container raíz**, no del
 * widget. Por eso `update_widget` / `replace_image` apuntaban al
 * container (que no acepta settings de widget) y fallaban con
 * `NOT_A_WIDGET`.
 *
 * El fix: pickElementId detecta que el ID apuntado es un container y
 * usa heurística sobre los args para encontrar el widget apropiado
 * (image si hay `media_id`, video si hay `video_type`, etc.).
 */

import { describe, it, expect } from 'vitest';
import {
  inferWidgetTypeFromArgs,
  findFirstWidgetOfType,
  ExecElementTreeNode,
} from '../../src/routes/changes.routes.js';

const tree: ExecElementTreeNode[] = [
  { id: 'cnt000a', elType: 'container' },
  { id: 'cnt000b', elType: 'container' },
  { id: 'widimg1', elType: 'widget', widgetType: 'image', settings: { image: { id: 119 } } },
  { id: 'widvid1', elType: 'widget', widgetType: 'video', settings: { video_type: 'hosted' } },
  { id: 'widtxt1', elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>Hi</p>' } },
];

describe('smart fallback en pickElementId', () => {
  describe('inferWidgetTypeFromArgs', () => {
    it('detecta image cuando args tienen media_id', () => {
      expect(inferWidgetTypeFromArgs({ media_id: 123 })).toBe('image');
    });
    it('detecta image por claves image/image_url', () => {
      expect(inferWidgetTypeFromArgs({ image_url: 'http://...' })).toBe('image');
    });
    it('detecta video cuando args tienen video_type', () => {
      expect(inferWidgetTypeFromArgs({ video_type: 'hosted' })).toBe('video');
    });
    it('detecta video cuando args tienen hosted_url', () => {
      expect(inferWidgetTypeFromArgs({ hosted_url: { id: 1 } })).toBe('video');
    });
    it('detecta video por youtube_url', () => {
      expect(inferWidgetTypeFromArgs({ youtube_url: 'http://youtu.be/...' })).toBe('video');
    });
    it('detecta heading con header_size + title', () => {
      expect(inferWidgetTypeFromArgs({ settings: { header_size: 'h2', title: 'Hi' } })).toBe(
        'heading'
      );
    });
    it('detecta form cuando hay form_fields', () => {
      expect(inferWidgetTypeFromArgs({ settings: { form_fields: [] } })).toBe('form');
    });
    it('detecta button cuando hay button_text', () => {
      expect(inferWidgetTypeFromArgs({ settings: { button_text: 'Click' } })).toBe('button');
    });
    it('detecta text-editor cuando solo hay text sin link', () => {
      expect(inferWidgetTypeFromArgs({ settings: { text: 'Hello' } })).toBe('text-editor');
    });
    it('detecta button cuando hay text + link', () => {
      expect(inferWidgetTypeFromArgs({ settings: { text: 'Click', link: '#' } })).toBe('button');
    });
    it('devuelve null para args vacíos', () => {
      expect(inferWidgetTypeFromArgs({})).toBeNull();
    });
  });

  describe('findFirstWidgetOfType', () => {
    it('encuentra image widget cuando widgetType=null', () => {
      expect(findFirstWidgetOfType(tree, 'image')).toBe('widimg1');
    });
    it('encuentra video widget', () => {
      expect(findFirstWidgetOfType(tree, 'video')).toBe('widvid1');
    });
    it('encuentra text-editor widget', () => {
      expect(findFirstWidgetOfType(tree, 'text-editor')).toBe('widtxt1');
    });
    it('devuelve null si no existe el tipo', () => {
      expect(findFirstWidgetOfType(tree, 'heading')).toBeNull();
    });
    it('con widgetType=null devuelve el primer widget de cualquier tipo', () => {
      expect(findFirstWidgetOfType(tree, null)).toBe('widimg1');
    });
    it('con tree undefined devuelve null', () => {
      expect(findFirstWidgetOfType(undefined, 'image')).toBeNull();
    });
    it('ignora containers', () => {
      const onlyContainers: ExecElementTreeNode[] = [
        { id: 'cnt1', elType: 'container' },
        { id: 'cnt2', elType: 'container' },
      ];
      expect(findFirstWidgetOfType(onlyContainers, 'image')).toBeNull();
    });
  });
});
