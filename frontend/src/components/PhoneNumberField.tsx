import { useEffect, useState } from "react"
import {
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { PHONE_COUNTRIES, flagEmoji } from "@/lib/phoneCountries"

// Matches the backend's DEFAULT_PHONE_REGION (backend/app/repos/forms.py)
// and the widget's defaultPhoneCountry fallback — bare digits with no
// country context are assumed Indian everywhere else in this app by
// default, so this field falls back the same way for a phone that hasn't
// been set yet, or one stored as legacy bare digits. Overridable per
// website via the `defaultCountry` prop (see show_country_dropdown /
// default_phone_country in widget_config).
const FALLBACK_COUNTRY: CountryCode = "IN"

// Splits a stored value — either legacy bare digits or an E.164
// "+<code><digits>" string — into (country, national digits) for the two
// controls below. Mirrors the widget's enhancePhoneField prefill logic
// (chat-widget.js) so a number saved by one surface displays consistently
// on the other.
function splitValue(value: string, fallbackCountry: CountryCode): { country: CountryCode; digits: string } {
  const trimmed = (value || "").trim()
  if (trimmed.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(trimmed)
    if (parsed) return { country: (parsed.country as CountryCode) || fallbackCountry, digits: parsed.nationalNumber }
  }
  return { country: fallbackCountry, digits: trimmed.replace(/\D/g, "") }
}

interface PhoneNumberFieldProps {
  value: string
  onChange: (value: string) => void
  required?: boolean
  className?: string
  // Per-website widget_config.show_country_dropdown — defaults true so
  // existing callers that don't pass it keep today's behavior.
  showCountrySelect?: boolean
  // Per-website widget_config.default_phone_country — only actually used
  // for a value with no existing country info (blank field, or legacy bare
  // digits); an existing E.164 value's own country always wins (splitValue).
  defaultCountry?: CountryCode
}

// Country-code select + national-number input, backed by libphonenumber-js
// — the dashboard counterpart to the widget's phone field (chat-widget.js's
// enhancePhoneField/_buildPhoneCountrySelect), used wherever an agent edits
// a visitor's phone number after the fact. Deliberately a plain native
// <select> rather than the widget's full searchable combobox: this only
// ever runs inside an already-open modal in the agent dashboard, where a
// ~240-option native select (browsable by typing) is a reasonable tradeoff
// against reimplementing that whole custom listbox.
export default function PhoneNumberField({
  value,
  onChange,
  required,
  className,
  showCountrySelect = true,
  defaultCountry = FALLBACK_COUNTRY,
}: PhoneNumberFieldProps) {
  const [{ country, digits }, setState] = useState(() => splitValue(value, defaultCountry))

  // Covers the case where the website's default_phone_country arrives from
  // an async fetch (ConversationsView's per-website widget_config lookup)
  // after this field already mounted with the FALLBACK_COUNTRY guess — only
  // while the field is still blank, so it never overrides a value the agent
  // already typed or one parsed from an existing E.164 number.
  useEffect(() => {
    if (!digits) setState((prev) => (prev.country === defaultCountry ? prev : { country: defaultCountry, digits: prev.digits }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCountry])

  const emit = (nextCountry: CountryCode, nextDigits: string) => {
    if (!nextDigits) {
      onChange("")
      return
    }
    const parsed = parsePhoneNumberFromString(nextDigits, nextCountry)
    onChange(parsed ? parsed.number : `+${getCountryCallingCode(nextCountry)}${nextDigits}`)
  }

  const isValid = !digits || isValidPhoneNumber(digits, country)

  return (
    <div className={className}>
      <div className="flex gap-1.5">
        {showCountrySelect ? (
          <select
            value={country}
            onChange={(e) => {
              const nextCountry = e.target.value as CountryCode
              setState({ country: nextCountry, digits })
              emit(nextCountry, digits)
            }}
            className="h-10 flex-shrink-0 w-[100px] rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {PHONE_COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {flagEmoji(c.iso)} +{c.dial}
              </option>
            ))}
          </select>
        ) : (
          // Dropdown disabled: still show the country as a static, non-interactive
          // label — matching what the widget recap / chat-thread contact-form card
          // both display (the raw "+91..." value) — instead of leaving the agent
          // looking at bare digits with no indication which country they belong to.
          <div
            className="h-10 flex-shrink-0 w-[60px] flex items-center justify-center rounded-md border border-input bg-muted text-sm text-muted-foreground select-none"
            title={`${flagEmoji(country)} +${getCountryCallingCode(country)}`}
          >
            +{getCountryCallingCode(country)}
          </div>
        )}
        <Input
          value={digits}
          placeholder={required ? "Phone number *" : "Phone number"}
          onChange={(e) => {
            const nextDigits = e.target.value.replace(/\D/g, "").slice(0, 15)
            setState({ country, digits: nextDigits })
            emit(country, nextDigits)
          }}
          className={cn("text-sm", !isValid && "border-red-500 focus-visible:ring-red-500")}
        />
      </div>
      {!isValid && <p className="text-xs text-red-500 mt-1">Please enter a valid phone number.</p>}
    </div>
  )
}
