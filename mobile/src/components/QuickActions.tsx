import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { FilePlus, FileText, Gift, Wallet } from 'lucide-react-native';
import { useApp } from '../context/AppContext';

interface QuickActionsProps {
  onUploadPress: () => void;
}

export default function QuickActions({ onUploadPress }: QuickActionsProps) {
  const { theme, setActiveTab } = useApp();

  const actions = [
    {
      label: 'Upload Bill',
      icon: FilePlus,
      onPress: onUploadPress,
      highlight: true,
    },
    {
      label: 'My Bills',
      icon: FileText,
      onPress: () => setActiveTab('BILLS'),
    },
    {
      label: 'Rewards',
      icon: Gift,
      onPress: () => setActiveTab('REWARDS'),
    },
    {
      label: 'Wallet',
      icon: Wallet,
      onPress: () => setActiveTab('WALLET'),
    },
  ];

  return (
    <View style={styles.container}>
      {actions.map((act, index) => {
        const Icon = act.icon;
        return (
          <TouchableOpacity
            key={index}
            style={styles.actionItem}
            onPress={act.onPress}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor: act.highlight ? theme.primaryLight : '#F8FAFC',
                  borderColor: act.highlight ? theme.primaryColor : '#E2E8F0',
                },
              ]}
            >
              <Icon
                size={22}
                color={act.highlight ? theme.primaryColor : '#475569'}
                strokeWidth={2.2}
              />
            </View>
            <Text
              style={[
                styles.actionLabel,
                { color: act.highlight ? theme.primaryColor : '#334155', fontWeight: act.highlight ? '700' : '600' },
              ]}
            >
              {act.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 6,
  },
  actionItem: {
    alignItems: 'center',
    width: '23%',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  actionLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
});
