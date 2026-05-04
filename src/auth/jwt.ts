import { jwtDecode } from "jwt-decode";

type AnotumJwtPayload = {
	exp: number;
};

export function getExpiresAt(token: string): number {
	const { exp } = jwtDecode<AnotumJwtPayload>(token);
	return exp * 1000;
}

export function isExpired(expiresAt: number): boolean {
	return Date.now() >= expiresAt;
}
