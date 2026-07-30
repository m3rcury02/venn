"use client";

import { useActionState } from "react";
import {
  saveOnboardingProfile,
  type OnboardingProfileState,
} from "@/app/onboarding/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";
import { labelClass } from "@/components/ui/label";
import type { Region } from "@/lib/providers";

const initialState: OnboardingProfileState = {};

export function OnboardingProfileForm({
  regions,
  initialRegion,
}: {
  regions: Region[];
  initialRegion: string;
}) {
  const [state, action, pending] = useActionState(
    saveOnboardingProfile,
    initialState,
  );

  return (
    <form action={action} className="flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="username" className={labelClass}>
          Username
        </label>
        <input
          id="username"
          name="username"
          required
          minLength={3}
          maxLength={30}
          pattern="[a-z0-9_]+"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="movie_friend"
          className={inputClass}
        />
        <p className="text-[13px] text-fg-faint">
          This becomes your public handle when profiles launch.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="region" className={labelClass}>
          Region
        </label>
        <select
          id="region"
          name="region"
          required
          defaultValue={initialRegion}
          className={inputClass}
        >
          {regions.map((region) => (
            <option key={region.code} value={region.code}>
              {region.name}
            </option>
          ))}
        </select>
        <p className="text-[13px] text-fg-faint">
          Used for local releases and where-to-watch results.
        </p>
      </div>

      {state.error ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonClass()}>
        {pending ? "Saving…" : "Choose your movies"}
      </button>
    </form>
  );
}
