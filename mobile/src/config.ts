import { ENVIRONMENTS, isEnvironment, type Environment } from "plyr-shared/origins";

const requested = process.env.EXPO_PUBLIC_PLYR_ENV;

export const ENVIRONMENT: Environment = isEnvironment(requested) ? requested : "production";
export const API = (process.env.EXPO_PUBLIC_API_ORIGIN ?? ENVIRONMENTS[ENVIRONMENT].api).replace(/\/$/, "");
export const WEB = ENVIRONMENTS[ENVIRONMENT].web;
