import { useEffect } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { restoreAuth, takeLoginIntent, useAuth } from '../../src/auth';

export default function OAuthCallback() {
	const { ready, did } = useAuth();
	useEffect(() => { void restoreAuth(); }, []);
	useEffect(() => { if (ready) router.replace(did ? (takeLoginIntent() ?? '/settings') : '/login'); }, [did, ready]);
	return (
		<View style={{ padding: 24, gap: 12, alignItems: 'center' }}>
			<ActivityIndicator />
			<Text>Finishing sign-in…</Text>
		</View>
	);
}
