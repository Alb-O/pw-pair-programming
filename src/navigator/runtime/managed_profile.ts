import { parseNavigatorProfile } from "../profile/profile_env";
import {
	NAVIGATOR_DEFAULT_SESSION_NAME,
	parseNavigatorSession,
} from "../session/session_env";
import { PP_DEFAULT_PROFILE_NAME } from "./pp_state_paths";

const isNonEmpty = (value?: string): value is string =>
	value !== undefined && value.trim() !== "";

export const resolveNavigatorManagedProfileName = ({
	profile,
	session,
}: {
	profile?: string;
	session?: string;
}): string => {
	if (isNonEmpty(profile)) {
		return parseNavigatorProfile(profile);
	}
	if (isNonEmpty(session)) {
		const parsedSession = parseNavigatorSession(session);
		if (parsedSession !== NAVIGATOR_DEFAULT_SESSION_NAME) {
			return parsedSession;
		}
	}
	return PP_DEFAULT_PROFILE_NAME;
};
