/** Configurações do app. */
import { Router } from 'express';
import { updateSettingsSchema } from '@hub/shared';
import { getSettings, updateSettings } from '../../db/repositories/settings';
import { rescheduleFeedSources, rescheduleNovelSources } from '../../scheduler';
import { parseBody } from '../errors';

export const settingsRouter = Router();

settingsRouter.get('/settings', (_req, res) => {
  res.json(getSettings());
});

settingsRouter.patch('/settings', (req, res) => {
  const body = parseBody(updateSettingsSchema, req.body);
  const settings = updateSettings(body);
  if (body.feedRefreshSeconds !== undefined) rescheduleFeedSources();
  if (body.novelRefreshMinutes !== undefined) rescheduleNovelSources();
  res.json(settings);
});
