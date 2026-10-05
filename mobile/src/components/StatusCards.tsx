import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock, CheckCircle } from 'lucide-react-native';
import { useApp } from '../context/AppContext';

export default function StatusCards() {
  const { wallet } = useApp();

  return (
    <View style={styles.container}>
      {/* Processing Card */}
      <View style={styles.card}>
        <View style={styles.iconWrapperOrange}>
          <Clock size={16} color="#EA580C" />
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.amountText}>
            ₹{wallet.processingAmount.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.labelOrange}>Processing</Text>
        </View>
      </View>

      {/* Available Card */}
      <View style={styles.card}>
        <View style={styles.iconWrapperGreen}>
          <CheckCircle size={16} color="#16A34A" />
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.amountText}>
            ₹{wallet.availableBalance.toLocaleString('en-IN')}
          </Text>
          <Text style={styles.labelGreen}>Available</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 12,
    gap: 12,
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  iconWrapperOrange: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  iconWrapperGreen: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F0FDF4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  textColumn: {
    flex: 1,
  },
  amountText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  labelOrange: {
    fontSize: 11,
    fontWeight: '600',
    color: '#EA580C',
    marginTop: 1,
  },
  labelGreen: {
    fontSize: 11,
    fontWeight: '600',
    color: '#16A34A',
    marginTop: 1,
  },
});
