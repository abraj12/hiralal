import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { PlusCircle, ShieldCheck } from 'lucide-react-native';
import { useApp } from '../context/AppContext';

interface ProfessionHeroBannerProps {
  onUploadPress: () => void;
}

export default function ProfessionHeroBanner({ onUploadPress }: ProfessionHeroBannerProps) {
  const { theme } = useApp();

  return (
    <View style={styles.container}>
      {/* Visual illustration banner from uploaded reference sheet */}
      <View style={[styles.bannerCard, { backgroundColor: theme.primaryLight }]}>
        <Image
          source={theme.bannerAsset}
          style={styles.bannerImage}
          resizeMode="cover"
        />

        <View style={styles.bannerContent}>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: theme.badgeBg }]}>
              <ShieldCheck size={12} color={theme.badgeText} />
              <Text style={[styles.badgeText, { color: theme.badgeText }]}>
                {theme.displayName} Rewards
              </Text>
            </View>
          </View>

          <Text style={styles.bannerTitle}>{theme.tagline}</Text>

          <TouchableOpacity
            style={[styles.ctaButton, { backgroundColor: theme.primaryColor }]}
            onPress={onUploadPress}
            activeOpacity={0.85}
          >
            <PlusCircle size={16} color="#ffffff" style={{ marginRight: 6 }} />
            <Text style={styles.ctaButtonText}>{theme.uploadTitle}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  bannerCard: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  bannerImage: {
    width: '100%',
    height: 110,
  },
  bannerContent: {
    padding: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 19,
    marginBottom: 12,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  ctaButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
});
