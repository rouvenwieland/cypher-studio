import {
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import * as Radio from "@radix-ui/react-radio-group";
import * as Toggle from "@radix-ui/react-toggle-group";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { GlyphError } from "./icons";
import { IconCheck, IconDown } from "./icons";

/** Feld mit sichtbarem Mono-Etikett über dem Steuerelement (DESIGN.md §9 Formulare). */
export function Field({
  label,
  help,
  error,
  children,
  htmlFor,
  helpId,
  errorId,
}: {
  label: string;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string | undefined;
  helpId?: string | undefined;
  errorId?: string | undefined;
}) {
  return (
    <div className="field">
      <label className="field__label t-label" {...(htmlFor ? { htmlFor } : {})}>
        {label}
      </label>
      {children}
      {help ? (
        <p className="field__help t-meta" {...(helpId ? { id: helpId } : {})}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="field__error t-meta" role="alert" {...(errorId ? { id: errorId } : {})}>
          <GlyphError size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "onChange" | "value"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: ReactNode;
  error?: ReactNode;
  mono?: boolean | undefined;
  unit?: string | undefined;
}

export function TextField({ label, value, onChange, help, error, mono, unit, id, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const input = (
    <input
      id={inputId}
      className={mono ? "input input--mono" : "input"}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      {...(error ? { "aria-invalid": true } : {})}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      {...rest}
    />
  );
  return (
    <Field label={label} help={help} error={error} htmlFor={inputId} helpId={helpId} errorId={errorId}>
      {unit ? (
        <div className="input-group">
          {input}
          <span className="input-group__unit">{unit}</span>
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "onChange" | "value"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  hideLabel?: boolean | undefined;
}

/** Natives <select> im Look der App: zugänglich, tastaturbedienbar, ohne Radix-Portale. */
export function SelectField({ label, value, onChange, options, hideLabel, id, ...rest }: SelectFieldProps) {
  const auto = useId();
  const selectId = id ?? auto;
  const control = (
    <div className="select">
      <select
        id={selectId}
        className="input select__control"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...(hideLabel ? { "aria-label": label } : {})}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="select__caret">
        <IconDown size={16} />
      </span>
    </div>
  );
  if (hideLabel) return control;
  return (
    <Field label={label} htmlFor={selectId}>
      {control}
    </Field>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
  indeterminate,
  describedBy,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean | undefined;
  indeterminate?: boolean | undefined;
  describedBy?: string | undefined;
  id?: string | undefined;
}) {
  // Sofort umschalten, auch wenn der Elternzustand erst einen Takt später ankommt (Einstellungen, Abfrage-Zwischenspeicher)
  const [on, setOn] = useState(checked);
  useEffect(() => setOn(checked), [checked]);
  return (
    <label className="check">
      <input
        id={id}
        type="checkbox"
        className="check__box"
        checked={on}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate === true;
        }}
        onChange={(e) => {
          setOn(e.target.checked);
          onChange(e.target.checked);
        }}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
      />
      <span className="check__text">{children}</span>
    </label>
  );
}

/** Segmentwahl (Umschalter): genau eine Option, Pfeiltasten wechseln. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  label: string;
}) {
  return (
    <Toggle.Root
      type="single"
      className="seg"
      value={value}
      aria-label={label}
      onValueChange={(v) => {
        if (v) onChange(v as T); // Radix liefert string; Optionen sind T
      }}
    >
      {options.map((o) => (
        <Toggle.Item
          key={o.value}
          value={o.value}
          className="seg__item"
          disabled={o.disabled}
          {...(o.title ? { title: o.title } : {})}
        >
          {o.label}
        </Toggle.Item>
      ))}
    </Toggle.Root>
  );
}

export interface SwatchOption {
  value: string;
  name: string;
  color: string;
  on: string;
}

/** Farbfelder als Radiogruppe (Pfeiltasten); der Name des gewählten Felds steht sichtbar daneben. */
export function SwatchGroup({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SwatchOption[];
  label: string;
}) {
  return (
    <Radio.Root className="swatches" value={value} onValueChange={onChange} aria-label={label} orientation="horizontal">
      {options.map((o) => (
        <Radio.Item
          key={o.value}
          value={o.value}
          className="swatch"
          aria-label={o.name}
          style={{ ["--swatch" as string]: o.color, ["--swatch-on" as string]: o.on }}
        >
          <Radio.Indicator className="swatch__check">
            <IconCheck size={16} />
          </Radio.Indicator>
        </Radio.Item>
      ))}
    </Radio.Root>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  valueText,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  valueText?: string | undefined;
}) {
  return (
    <SliderPrimitive.Root
      className="slider"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v[0] ?? value)}
    >
      <SliderPrimitive.Track className="slider__track">
        <SliderPrimitive.Range className="slider__range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className="slider__thumb"
        aria-label={label}
        {...(valueText ? { "aria-valuetext": valueText } : {})}
      />
    </SliderPrimitive.Root>
  );
}
