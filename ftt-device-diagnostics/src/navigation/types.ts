import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Home: undefined;
  Test: { testId: string };
  Summary: undefined;
  Reports: undefined;
  ReportDetail: { reportId: string };
};

export type HomeProps = NativeStackScreenProps<RootStackParamList, 'Home'>;
export type TestProps = NativeStackScreenProps<RootStackParamList, 'Test'>;
export type SummaryProps = NativeStackScreenProps<RootStackParamList, 'Summary'>;
export type ReportsProps = NativeStackScreenProps<RootStackParamList, 'Reports'>;
export type ReportDetailProps = NativeStackScreenProps<RootStackParamList, 'ReportDetail'>;
