import { ViewState } from '../types';

/**
 * THE TECHNICIAN SHELL'S TWO SCREENS.
 *
 * Technicians do not go through the main app shell or its navigation — by the
 * owner's decision they get one focused screen, not a full nav. That shell was
 * hard-wired to the repairs view, which made 'builds.manage' a permission a
 * technician held and could never use: there was no route to PC Builds from
 * anywhere in it.
 *
 * So the shell now has exactly two screens and one button between them. This
 * function is the ONLY way to move: anything that is not the builds screen
 * lands on repairs, so no other view is reachable for this role by any route —
 * including a stale value, a bad prop, or anything a URL could carry.
 *
 * Pure: no DOM, no Firestore. It is a whitelist, deliberately, rather than a
 * list of things to exclude — a view added next year is unreachable here
 * without somebody choosing to add it.
 */

export type TechScreen = 'repairs' | 'pcbuilds';

export const TECH_SCREENS: TechScreen[] = ['repairs', 'pcbuilds'];

/**
 * Which screen a technician actually gets.
 *
 * `canBuild` is allow('builds.manage'). Without it the builds screen is not
 * merely hidden — it cannot be resolved to at all, so revoking the permission
 * while that screen is open falls back to repairs on the next render rather
 * than leaving it up.
 */
export const techScreenFor = (requested: ViewState | TechScreen | undefined, canBuild: boolean): TechScreen =>
  requested === 'pcbuilds' && canBuild ? 'pcbuilds' : 'repairs';
