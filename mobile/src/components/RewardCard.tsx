import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { ArrowRight, Sparkles } from 'lucide-react-native';
import { useApp } from '../context/AppContext';

interface RewardCardProps {
  onPress?: () => void;
}

export default function RewardCard({ onPress }: RewardCardProps) {
  const { theme, wallet } = useApp();

  const totalRewards = wallet.availableBalance + wallet.totalRedeemed;

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme.primaryColor }]}
      onPress={onPress}
      activeOpacity={0.9}
    >
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.titleLabel}>{theme.rewardTitle}</Text>
          <View style={styles.sparkleTag}>
            <Sparkles size={11} color="#ffffff" />
            <Text style={styles.sparkleText}>0.5% Cashback</Text>
          </View>
        </View>

        <View style={styles.amountRow}>
          <View>
            <Text style={styles.amountText}>
              ₹{totalRewards.toLocaleString('en-IN')}
            </Text>
            <Text style={styles.subtext}>Lifetime Earned Rewards</Text>
          </View>

          <View style={styles.arrowCircle}>
            <ArrowRight size={18} color={theme.primaryColor} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginTop: 12,
    borderRadius: 22,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  content: {
    zIndex: 2,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleLabel: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sparkleTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 4,
  },
  sparkleText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  amountText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  subtext: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '500',
  },
  arrowCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
});
