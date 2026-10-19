import chalk from 'chalk';
import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { ModelPicker } from '../../components/ModelPicker.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import type { EffortLevel } from '../../utils/effort.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import {
  clearFastModeCooldown,
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js';
import { MODEL_ALIASES } from '../../utils/model/aliases.js';
import { checkOpus1mAccess, checkSonnet1mAccess } from '../../utils/model/check1mAccess.js';
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
} from '../../utils/model/model.js';
import { isModelAllowed } from '../../utils/model/modelAllowlist.js';
import { validateModel } from '../../utils/model/validateModel.js';
import { setMainLoopModelOverride } from '../../bootstrap/state.js';
import {
  resolveProfileAndModel,
  switchProfile,
  getActiveProviderProfileId,
} from '../../utils/model/providerProfiles.js';
import { applyConfigEnvironmentVariables } from '../../utils/managedEnv.js';

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const isFastMode = useAppState(s => s.fastMode);
  const setAppState = useSetAppState();

  function handleCancel(): void {
    logEvent('tengu_model_command_menu', {
      action: 'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    const displayModel = renderModelLabel(mainLoopModel);
    onDone(`Kept model as ${chalk.bold(displayModel)}`, {
      display: 'system',
    });
  }

  function handleSelect(model: string | null, effort: EffortLevel | undefined): void {
    logEvent('tengu_model_command_menu', {
      action: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_model: mainLoopModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });

    const { profileId, modelName, profile } = resolveProfileAndModel(model);
    let switchedProfile = false;
    if (profileId && profileId !== getActiveProviderProfileId()) {
      switchProfile(profileId);
      applyConfigEnvironmentVariables();
      switchedProfile = true;
    }

    const finalModel = modelName;
    setMainLoopModelOverride(finalModel);
    setAppState(prev => ({
      ...prev,
      mainLoopModel: finalModel,
      mainLoopModelForSession: null,
    }));

    let message =
      switchedProfile && profile
        ? `Switched provider to ${chalk.bold(profile.name)} · Set model to ${chalk.bold(renderModelLabel(finalModel))}`
        : `Set model to ${chalk.bold(renderModelLabel(finalModel))}`;
    if (effort !== undefined) {
      message += ` with ${chalk.bold(effort)} effort`;
    }

    // Turn off fast mode if switching to unsupported model
    let wasFastModeToggledOn;
    if (isFastModeEnabled()) {
      clearFastModeCooldown();
      if (!isFastModeSupportedByModel(finalModel) && isFastMode) {
        setAppState(prev => ({
          ...prev,
          fastMode: false,
        }));
        wasFastModeToggledOn = false;
        // Do not update fast mode in settings since this is an automatic downgrade
      } else if (isFastModeSupportedByModel(finalModel) && isFastModeAvailable() && isFastMode) {
        message += ` · Fast mode ON`;
        wasFastModeToggledOn = true;
      }
    }

    if (isBilledAsExtraUsage(finalModel, wasFastModeToggledOn === true, isOpus1mMergeEnabled())) {
      message += ` · Billed as extra usage`;
    }

    if (wasFastModeToggledOn === false) {
      // Fast mode was toggled off, show suffix after extra usage billing
      message += ` · Fast mode OFF`;
    }

    onDone(message);
  }

  return (
    <ModelPicker
      initial={mainLoopModel}
      sessionModel={mainLoopModelForSession}
      onSelect={handleSelect}
      onCancel={handleCancel}
      isStandaloneCommand
      showFastModeNotice={
        isFastModeEnabled() && isFastMode && isFastModeSupportedByModel(mainLoopModel) && isFastModeAvailable()
      }
    />
  );
}

function SetModelAndClose({
  args,
  onDone,
}: {
  args: string;
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const isFastMode = useAppState(s => s.fastMode);
  const setAppState = useSetAppState();
  const model = args === 'default' ? null : args;

  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      const { profileId, modelName: resolvedModelName, profile } = resolveProfileAndModel(model);
      let switchedProfile = false;
      if (profileId && profileId !== getActiveProviderProfileId()) {
        switchProfile(profileId);
        applyConfigEnvironmentVariables();
        switchedProfile = true;
      }
      const effectiveModel = resolvedModelName;

      if (effectiveModel && !isModelAllowed(effectiveModel)) {
        onDone(`Model '${effectiveModel}' is not available. Your organization restricts model selection.`, {
          display: 'system',
        });
        return;
      }

      // @[MODEL LAUNCH]: Update check for 1M access.
      if (effectiveModel && isOpus1mUnavailable(effectiveModel)) {
        onDone(
          `Opus 4.7 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
          { display: 'system' },
        );
        return;
      }

      if (effectiveModel && isSonnet1mUnavailable(effectiveModel)) {
        onDone(
          `Sonnet 4.6 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
          { display: 'system' },
        );
        return;
      }

      // Skip validation for default model
      if (!effectiveModel) {
        setModel(null);
        return;
      }

      // Skip validation for known aliases - they're predefined and should work
      if (isKnownAlias(effectiveModel)) {
        setModel(effectiveModel);
        return;
      }

      // Validate and set custom model
      try {
        // Don't use parseUserSpecifiedModel for non-aliases since it lowercases the input
        // and model names are case-sensitive
        const { valid, error } = await validateModel(effectiveModel);

        if (valid) {
          setModel(effectiveModel);
        } else {
          onDone(error || `Model '${effectiveModel}' not found`, {
            display: 'system',
          });
        }
      } catch (error) {
        onDone(`Failed to validate model: ${(error as Error).message}`, {
          display: 'system',
        });
      }

      function setModel(modelValue: string | null): void {
        setMainLoopModelOverride(modelValue);
        setAppState(prev => ({
          ...prev,
          mainLoopModel: modelValue,
          mainLoopModelForSession: null,
        }));
        let message =
          switchedProfile && profile
            ? `Switched provider to ${chalk.bold(profile.name)} · Set model to ${chalk.bold(renderModelLabel(modelValue))}`
            : `Set model to ${chalk.bold(renderModelLabel(modelValue))}`;

        let wasFastModeToggledOn;
        if (isFastModeEnabled()) {
          clearFastModeCooldown();
          if (!isFastModeSupportedByModel(modelValue) && isFastMode) {
            setAppState(prev => ({
              ...prev,
              fastMode: false,
            }));
            wasFastModeToggledOn = false;
            // Do not update fast mode in settings since this is an automatic downgrade
          } else if (isFastModeSupportedByModel(modelValue) && isFastMode) {
            message += ` · Fast mode ON`;
            wasFastModeToggledOn = true;
          }
        }

        if (isBilledAsExtraUsage(modelValue, wasFastModeToggledOn === true, isOpus1mMergeEnabled())) {
          message += ` · Billed as extra usage`;
        }

        if (wasFastModeToggledOn === false) {
          // Fast mode was toggled off, show suffix after extra usage billing
          message += ` · Fast mode OFF`;
        }

        onDone(message);
      }
    }

    void handleModelChange();
  }, [model, onDone, setAppState]);

  return null;
}

function isKnownAlias(model: string): boolean {
  return (MODEL_ALIASES as readonly string[]).includes(model.toLowerCase().trim());
}

function isOpus1mUnavailable(model: string): boolean {
  const m = model.toLowerCase();
  return !checkOpus1mAccess() && !isOpus1mMergeEnabled() && m.includes('opus') && m.includes('[1m]');
}

function isSonnet1mUnavailable(model: string): boolean {
  const m = model.toLowerCase();
  // Warn about Sonnet and Sonnet 4.6, but not Sonnet 4.5 since that had
  // a different access criteria.
  return !checkSonnet1mAccess() && (m.includes('sonnet[1m]') || m.includes('sonnet-4-6[1m]'));
}

function ShowModelAndClose({ onDone }: { onDone: (result?: string) => void }): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const effortValue = useAppState(s => s.effortValue);
  const displayModel = renderModelLabel(mainLoopModel);
  const effortInfo = effortValue !== undefined ? ` (effort: ${effortValue})` : '';

  if (mainLoopModelForSession) {
    onDone(
      `Current model: ${chalk.bold(renderModelLabel(mainLoopModelForSession))} (session override from plan mode)\nBase model: ${displayModel}${effortInfo}`,
    );
  } else {
    onDone(`Current model: ${displayModel}${effortInfo}`);
  }

  return null;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || '';
  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    return <ShowModelAndClose onDone={onDone} />;
  }
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('Run /model to open the model selection menu, or /model [modelName] to set the model.', {
      display: 'system',
    });
    return;
  }

  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    });
    return <SetModelAndClose args={args} onDone={onDone} />;
  }

  return <ModelPickerWrapper onDone={onDone} />;
};

function renderModelLabel(model: string | null): string {
  const rendered = renderDefaultModelSetting(model ?? getDefaultMainLoopModelSetting());
  return model === null ? `${rendered} (default)` : rendered;
}
