import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MachinePiExtensionsResponse, PiExtensionDiscovery } from '@lody/shared';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';

export function PiExtensionsField({
  value,
  onChange,
  onScan,
  supported,
}: {
  value: string[];
  onChange: (paths: string[]) => void;
  onScan?: () => Promise<MachinePiExtensionsResponse>;
  supported: boolean;
}) {
  const { t } = useTranslation();
  const [discovery, setDiscovery] = useState<PiExtensionDiscovery>();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const scan = async () => {
    if (!onScan || !supported) return;
    const current = ++generation.current;
    setScanning(true);
    setError('');
    try {
      const result = await onScan();
      if (current !== generation.current) return;
      if (result.success) setDiscovery(result.discovery);
      else setError(result.error);
    } catch {
      if (current === generation.current) setError(t('piExtensions.scanFailed'));
    } finally {
      if (current === generation.current) setScanning(false);
    }
  };
  const candidates = new Map((discovery?.extensions ?? []).map((item) => [item.path, item.name]));
  for (const selected of value)
    if (!candidates.has(selected))
      candidates.set(selected, selected.split(/[\\/]/).pop() ?? selected);
  const add = (candidate: string) => {
    if (!supported || value.includes(candidate)) return;
    if (value.length >= 32) {
      setError(t('piExtensions.limit'));
      return;
    }
    onChange([...value, candidate]);
    setError('');
  };
  return (
    <section aria-label={t('piExtensions.title')} className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-medium">{t('piExtensions.title')}</h3>
      <p className="text-xs text-muted-foreground">{t('piExtensions.consent')}</p>
      {!supported && (
        <p role="status" className="text-xs text-status-warning">
          {t('piExtensions.unsupported')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!supported || !onScan || scanning}
          onClick={() => void scan()}
        >
          {scanning ? t('piExtensions.scanning') : t('piExtensions.scan')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('piExtensions.profileHint')}</p>
      {discovery && (
        <>
          <p className="break-all font-mono text-xs">{discovery.agentDir}</p>
          {discovery.warnings.map((warning) => (
            <p key={warning} className="text-xs text-status-warning">
              {warning}
            </p>
          ))}
          {discovery.extensions.length === 0 && (
            <p className="text-xs text-muted-foreground">{t('piExtensions.empty')}</p>
          )}
        </>
      )}
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {[...candidates].map(([candidate, name]) => (
          <label key={candidate} className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={value.includes(candidate)}
              disabled={!supported && !value.includes(candidate)}
              onCheckedChange={(checked) =>
                checked === true
                  ? add(candidate)
                  : onChange(value.filter((item) => item !== candidate))
              }
            />
            <span className="min-w-0">
              <span className="block">{name}</span>
              <span className="block break-all font-mono text-xs text-muted-foreground">
                {candidate}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          aria-label={t('piExtensions.path')}
          placeholder={t('piExtensions.placeholder')}
          value={path}
          disabled={!supported}
          onChange={(event) => setPath(event.target.value)}
          className="min-w-0 font-mono text-xs"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={!supported || !path.trim() || value.length >= 32}
          onClick={() => {
            add(path.trim());
            setPath('');
          }}
        >
          {t('piExtensions.add')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
