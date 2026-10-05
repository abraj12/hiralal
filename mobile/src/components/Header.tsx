import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Bell, RefreshCw } from 'lucide-react-native';
import { useApp } from '../context/AppContext';

export default function Header() {
  const { user, theme, profession, switchProfessionLive } = useApp();

  const toggleProfession = () => {
    if (profession === 'PLUMBER') {
      switchProfessionLive('TILE_INSTALLER');
    } else {
      switchProfessionLive('PLUMBER');
    }
  };

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.greetingText}>Good morning,</Text>
        <Text style={styles.nameText}>{user?.fullName || 'Valued Partner'} 👋</Text>
      </View>

      <View style={styles.rightActions}>
        {/* Quick Profession Switcher for Live Demo */}
        <TouchableOpacity
          style={[styles.professionBadge, { backgroundColor: theme.primaryLight, borderColor: theme.primaryColor }]}
          onPress={toggleProfession}
          activeOpacity={0.8}
        >
          <Text style={[styles.professionBadgeText, { color: theme.primaryColor }]}>
            {theme.displayName}
          </Text>
          <RefreshCw size={12} color={theme.primaryColor} style={{ marginLeft: 4 }} />
        </TouchableOpacity>

        {/* Notification Bell */}
        <TouchableOpacity style={styles.bellButton}>
          <Bell size={20} color="#334155" />
          <View style={styles.badgeDot} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
  },
  greetingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  nameText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  professionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  professionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bellButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  badgeDot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#EF4444',
  },
});
