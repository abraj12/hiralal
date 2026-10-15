import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Switch,
  Modal,
  Image,
} from 'react-native';
import {
  TrendingUp,
  Bell,
  ShieldCheck,
  Sliders,
  Send,
  Calendar,
  Clock,
  Layers,
  Percent,
  CheckCircle2,
  XCircle,
  X,
  FileText,
} from 'lucide-react-native';
import { MobileApiClient } from '../../services/api';
import { parseIndiaIsoDateTime } from '../../utils/date-utils';

type MoreSubTab = 'REWARDS' | 'BROADCAST' | 'AUDIT' | 'SETTINGS';

function formatISTDateParts(isoString: string): { date: string; time: string } {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(d);
    const p: Record<string, string> = {};
    for (const part of parts) {
      p[part.type] = part.value;
    }
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      time: `${p.hour}:${p.minute}`,
    };
  } catch {
    return { date: '', time: '' };
  }
}

interface OpsAdminMoreScreenProps {
  initialSubTab?: MoreSubTab;
}

export default function OpsAdminMoreScreen({ initialSubTab = 'REWARDS' }: OpsAdminMoreScreenProps) {
  const [activeSubTab, setActiveSubTab] = useState<MoreSubTab>(initialSubTab);
  const [loading, setLoading] = useState(false);

  // --- 1. Rewards & Ledger State ---
  const [plumberRule, setPlumberRule] = useState<any>(null);
  const [tileRule, setTileRule] = useState<any>(null);
  const [rewardsStats, setRewardsStats] = useState<any>(null);

  // Rate Adjustment Form
  const [rateModalProfession, setRateModalProfession] = useState<'PLUMBER' | 'TILE_INSTALLER' | null>(null);
  const [newRatePercent, setNewRatePercent] = useState('');
  const [savingRate, setSavingRate] = useState(false);

  // --- 2. Broadcast State ---
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [targetAudience, setTargetAudience] = useState<'ALL' | 'PLUMBER' | 'TILE_INSTALLER'>('ALL');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastHistory, setBroadcastHistory] = useState<any[]>([]);

  // --- 3. Audit Logs State ---
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [selectedAuditLog, setSelectedAuditLog] = useState<any | null>(null);

  // --- 4. Settings State ---
  const [redemptionSettings, setRedemptionSettings] = useState<any>(null);
  const [isRedemptionOpen, setIsRedemptionOpen] = useState(false);
  const [minRedemptionAmt, setMinRedemptionAmt] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [redemptionMsg, setRedemptionMsg] = useState('');
  const [gstRules, setGstRules] = useState<any[]>([]);
  const [newGstRate, setNewGstRate] = useState('');
  const [newGstDesc, setNewGstDesc] = useState('');
  const [showAddGstModal, setShowAddGstModal] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Initial Data Fetch per Sub-Tab
  useEffect(() => {
    loadSubTabData(activeSubTab);
  }, [activeSubTab]);

  const loadSubTabData = async (tab: MoreSubTab) => {
    setLoading(true);
    try {
      if (tab === 'REWARDS') {
        const [dashRes, pRes, tRes] = await Promise.all([
          MobileApiClient.getAdminDashboard('ALL').catch(() => null),
          MobileApiClient.getAdminRewardRules('PLUMBER').catch(() => null),
          MobileApiClient.getAdminRewardRules('TILE_INSTALLER').catch(() => null),
        ]);
        if (dashRes && dashRes.stats) setRewardsStats(dashRes.stats);
        if (pRes && pRes.rules) {
          const active = pRes.rules.find((r: any) => r.isActive) || pRes.rules[0];
          setPlumberRule(active);
        }
        if (tRes && tRes.rules) {
          const active = tRes.rules.find((r: any) => r.isActive) || tRes.rules[0];
          setTileRule(active);
        }
      } else if (tab === 'BROADCAST') {
        const res = await MobileApiClient.getAdminNotificationHistory(1, 20).catch(() => null);
        if (res && res.campaigns) setBroadcastHistory(res.campaigns);
      } else if (tab === 'AUDIT') {
        const res = await MobileApiClient.getAdminAuditLogs().catch(() => null);
        if (res && res.logs) setAuditLogs(res.logs);
      } else if (tab === 'SETTINGS') {
        const [redempRes, gstRes] = await Promise.all([
          MobileApiClient.getAdminRedemptionSettings('ALL').catch(() => null),
          MobileApiClient.getGstRules().catch(() => null),
        ]);
        if (redempRes && redempRes.settings) {
          setRedemptionSettings(redempRes.settings);
          setIsRedemptionOpen(!!redempRes.settings.isEnabled);
          setMinRedemptionAmt(
            redempRes.settings.minimumRedemptionAmount !== null && redempRes.settings.minimumRedemptionAmount !== undefined
              ? String(redempRes.settings.minimumRedemptionAmount)
              : ''
          );
          setRedemptionMsg(redempRes.settings.message || '');
          if (redempRes.settings.startAt) {
            const { date, time } = formatISTDateParts(redempRes.settings.startAt);
            setStartDate(date);
            setStartTime(time);
          } else {
            setStartDate('');
            setStartTime('');
          }
          if (redempRes.settings.endAt) {
            const { date, time } = formatISTDateParts(redempRes.settings.endAt);
            setEndDate(date);
            setEndTime(time);
          } else {
            setEndDate('');
            setEndTime('');
          }
        }
        if (gstRes && gstRes.rules) {
          setGstRules(gstRes.rules);
        }
      }
    } catch (e: any) {
      console.warn('Sub-tab fetch failed:', e?.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Handlers: Rewards ---
  const handleSaveRate = async () => {
    if (!rateModalProfession || !newRatePercent.trim()) return;
    const rateNum = Number(newRatePercent.trim());
    if (isNaN(rateNum) || rateNum <= 0 || rateNum > 100) {
      Alert.alert('Invalid Rate', 'Please enter a percentage between 0.01% and 100%.');
      return;
    }

    setSavingRate(true);
    try {
      await MobileApiClient.createAdminRewardRule({
        profession: rateModalProfession,
        rewardPercentage: rateNum,
      });
      Alert.alert('Rate Updated', `Incentive rate for ${rateModalProfession} set to ${rateNum}%.`);
      setRateModalProfession(null);
      setNewRatePercent('');
      loadSubTabData('REWARDS');
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not update rule.');
    } finally {
      setSavingRate(false);
    }
  };

  // --- Handlers: Broadcast ---
  const handleSendBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      Alert.alert('Missing Fields', 'Please enter both an announcement title and message.');
      return;
    }

    setSendingBroadcast(true);
    try {
      await MobileApiClient.broadcastAdminNotification({
        title: broadcastTitle.trim(),
        message: broadcastMessage.trim(),
        targetAudience,
      });
      Alert.alert('Announcement Sent', 'Push notification successfully broadcasted to all recipients.');
      setBroadcastTitle('');
      setBroadcastMessage('');
      loadSubTabData('BROADCAST');
    } catch (e: any) {
      Alert.alert('Broadcast Failed', e?.message || 'Could not dispatch notification.');
    } finally {
      setSendingBroadcast(false);
    }
  };

  // --- Handlers: Settings ---
  const handleSaveRedemption = async () => {
    setSavingSettings(true);
    try {
      let startAt: string | null = null;
      let endAt: string | null = null;

      if (isRedemptionOpen) {
        if (!startDate.trim() || !startTime.trim()) {
          Alert.alert('Dates Required', 'Both start date (YYYY-MM-DD) and start time (HH:MM) are required to enable redemption.');
          setSavingSettings(false);
          return;
        }
        if (!endDate.trim() || !endTime.trim()) {
          Alert.alert('Dates Required', 'Both end date (YYYY-MM-DD) and end time (HH:MM) are required to enable redemption.');
          setSavingSettings(false);
          return;
        }

        let startParsed: string;
        let endParsed: string;
        try {
          startParsed = parseIndiaIsoDateTime(startDate.trim(), startTime.trim());
        } catch (err: any) {
          Alert.alert('Invalid Start Date/Time', err?.message || 'Invalid start date or time format.');
          setSavingSettings(false);
          return;
        }

        try {
          endParsed = parseIndiaIsoDateTime(endDate.trim(), endTime.trim());
        } catch (err: any) {
          Alert.alert('Invalid End Date/Time', err?.message || 'Invalid end date or time format.');
          setSavingSettings(false);
          return;
        }

        if (new Date(endParsed).getTime() <= new Date(startParsed).getTime()) {
          Alert.alert('Invalid Range', 'Closing date/time must be after opening date/time.');
          setSavingSettings(false);
          return;
        }

        startAt = startParsed;
        endAt = endParsed;

        if (!minRedemptionAmt.trim() || isNaN(Number(minRedemptionAmt)) || Number(minRedemptionAmt) <= 0) {
          Alert.alert('Threshold Required', 'Please enter a valid positive minimum redemption amount.');
          setSavingSettings(false);
          return;
        }
      } else {
        if (startDate.trim() && startTime.trim()) {
          try {
            startAt = parseIndiaIsoDateTime(startDate.trim(), startTime.trim());
          } catch {
            // Retain original or omit if invalid when disabled
          }
        }
        if (endDate.trim() && endTime.trim()) {
          try {
            endAt = parseIndiaIsoDateTime(endDate.trim(), endTime.trim());
          } catch {
            // Retain original or omit if invalid when disabled
          }
        }
      }

      const minAmt = minRedemptionAmt.trim() ? Number(minRedemptionAmt) : null;

      await MobileApiClient.updateAdminRedemptionSettings({
        isEnabled: isRedemptionOpen,
        startAt,
        endAt,
        minimumRedemptionAmount: minAmt,
        message: redemptionMsg.trim() || (isRedemptionOpen ? 'Open for verified craftsmen.' : 'Redemption window currently closed.'),
      });
      Alert.alert('Settings Saved', 'Cashback redemption window rules updated.');
    } catch (e: any) {
      Alert.alert('Save Failed', e?.message || 'Could not save redemption settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddGstRule = async () => {
    const rate = Number(newGstRate.trim());
    if (isNaN(rate) || rate < 0 || rate > 100) {
      Alert.alert('Invalid GST Rate', 'Enter a valid GST rate percentage.');
      return;
    }

    try {
      await MobileApiClient.createAdminGstRule({
        ratePercentage: rate,
        description: newGstDesc.trim() || `GST ${rate}%`,
        isDefault: false,
      });
      Alert.alert('GST Rule Added', `Added GST rule at ${rate}%.`);
      setShowAddGstModal(false);
      setNewGstRate('');
      setNewGstDesc('');
      loadSubTabData('SETTINGS');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to add GST rule.');
    }
  };

  return (
    <View style={styles.container}>
      {/* Sub-Tab Header Bar */}
      <View style={styles.subTabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subTabScroll}>
          <TouchableOpacity
            style={[styles.subTabItem, activeSubTab === 'REWARDS' && styles.subTabItemActive]}
            onPress={() => setActiveSubTab('REWARDS')}
          >
            <TrendingUp size={15} color={activeSubTab === 'REWARDS' ? '#DC2626' : '#64748B'} />
            <Text style={[styles.subTabLabel, activeSubTab === 'REWARDS' && styles.subTabLabelActive]}>
              Rewards & Ledger
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTabItem, activeSubTab === 'BROADCAST' && styles.subTabItemActive]}
            onPress={() => setActiveSubTab('BROADCAST')}
          >
            <Bell size={15} color={activeSubTab === 'BROADCAST' ? '#DC2626' : '#64748B'} />
            <Text style={[styles.subTabLabel, activeSubTab === 'BROADCAST' && styles.subTabLabelActive]}>
              Broadcast
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTabItem, activeSubTab === 'AUDIT' && styles.subTabItemActive]}
            onPress={() => setActiveSubTab('AUDIT')}
          >
            <ShieldCheck size={15} color={activeSubTab === 'AUDIT' ? '#DC2626' : '#64748B'} />
            <Text style={[styles.subTabLabel, activeSubTab === 'AUDIT' && styles.subTabLabelActive]}>
              Audit Trail
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTabItem, activeSubTab === 'SETTINGS' && styles.subTabItemActive]}
            onPress={() => setActiveSubTab('SETTINGS')}
          >
            <Sliders size={15} color={activeSubTab === 'SETTINGS' ? '#DC2626' : '#64748B'} />
            <Text style={[styles.subTabLabel, activeSubTab === 'SETTINGS' && styles.subTabLabelActive]}>
              System Settings
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Main Tab Content */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#DC2626" />
          <Text style={styles.loadingText}>Fetching operational data...</Text>
        </View>
      ) : (
        <ScrollView style={styles.contentScroll} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
          {/* ======================================================== */}
          {/* SUBTAB 1: REWARDS & FINANCIAL LEDGER */}
          {/* ======================================================== */}
          {activeSubTab === 'REWARDS' && (
            <View>
              <Text style={styles.sectionTitle}>Incentive Distribution Rules</Text>

              {/* Plumber Rule Card */}
              <View style={[styles.ruleCard, styles.ruleCardBlue]}>
                <View style={styles.ruleCardTop}>
                  <View>
                    <Text style={styles.ruleTitle}>Plumbing Rewards</Text>
                    <Text style={styles.ruleSub}>Pipes, Sanitaryware, CPVC Valves</Text>
                  </View>
                  <Text style={[styles.ruleRate, { color: '#1D4ED8' }]}>
                    {plumberRule?.rewardPercentage !== undefined ? `${plumberRule.rewardPercentage}%` : 'Unconfigured'}
                  </Text>
                </View>
                <View style={styles.ruleCardBottom}>
                  <Text style={styles.ruleMeta}>
                    Version {plumberRule?.version || 1} • Effective Date: Active
                  </Text>
                  <TouchableOpacity
                    style={styles.ruleEditBtn}
                    onPress={() => {
                      setRateModalProfession('PLUMBER');
                      setNewRatePercent(plumberRule?.rewardPercentage !== undefined ? String(plumberRule.rewardPercentage) : '');
                    }}
                  >
                    <Text style={styles.ruleEditBtnText}>Adjust Rate</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Tile Rule Card */}
              <View style={[styles.ruleCard, styles.ruleCardOrange]}>
                <View style={styles.ruleCardTop}>
                  <View>
                    <Text style={styles.ruleTitle}>Tile Artisans Rewards</Text>
                    <Text style={styles.ruleSub}>Ceramic, Porcelain, Adhesives</Text>
                  </View>
                  <Text style={[styles.ruleRate, { color: '#C2410C' }]}>
                    {tileRule?.rewardPercentage !== undefined ? `${tileRule.rewardPercentage}%` : 'Unconfigured'}
                  </Text>
                </View>
                <View style={styles.ruleCardBottom}>
                  <Text style={styles.ruleMeta}>
                    Version {tileRule?.version || 1} • Effective Date: Active
                  </Text>
                  <TouchableOpacity
                    style={[styles.ruleEditBtn, { borderColor: '#FDBA74' }]}
                    onPress={() => {
                      setRateModalProfession('TILE_INSTALLER');
                      setNewRatePercent(tileRule?.rewardPercentage !== undefined ? String(tileRule.rewardPercentage) : '');
                    }}
                  >
                    <Text style={[styles.ruleEditBtnText, { color: '#C2410C' }]}>Adjust Rate</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Financial Ledger Summary */}
              <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Ledger Liabilities Overview</Text>
              <View style={styles.ledgerGrid}>
                <View style={styles.ledgerBox}>
                  <Text style={styles.ledgerLabel}>Total Credited</Text>
                  <Text style={styles.ledgerValue}>
                    {Number(rewardsStats?.totalRewardsCredited ?? 0).toLocaleString('en-IN')} Points
                  </Text>
                </View>
                <View style={styles.ledgerBox}>
                  <Text style={styles.ledgerLabel}>Active Liability</Text>
                  <Text style={[styles.ledgerValue, { color: '#D97706' }]}>
                    {Number(rewardsStats?.availableWalletLiability ?? 0).toLocaleString('en-IN')} Points
                  </Text>
                </View>
                <View style={styles.ledgerBox}>
                  <Text style={styles.ledgerLabel}>Settled Payouts</Text>
                  <Text style={[styles.ledgerValue, { color: '#16A34A' }]}>
                    {Number(rewardsStats?.totalRedeemed ?? 0).toLocaleString('en-IN')} Points
                  </Text>
                </View>
                <View style={styles.ledgerBox}>
                  <Text style={styles.ledgerLabel}>Pending Release</Text>
                  <Text style={[styles.ledgerValue, { color: '#DC2626' }]}>
                    {Number(rewardsStats?.pendingPayoutAmount ?? 0).toLocaleString('en-IN')} Points
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* ======================================================== */}
          {/* SUBTAB 2: BROADCAST NOTIFICATIONS */}
          {/* ======================================================== */}
          {activeSubTab === 'BROADCAST' && (
            <View>
              <Text style={styles.sectionTitle}>Compose Broadcast Announcement</Text>

              <View style={styles.composerCard}>
                <Text style={styles.inputLabel}>Announcement Title *</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Special Festival Cashback Scheme 2026"
                  value={broadcastTitle}
                  onChangeText={setBroadcastTitle}
                />

                <Text style={[styles.inputLabel, { marginTop: 12 }]}>Target Trade Audience *</Text>
                <View style={styles.audienceRow}>
                  {(['ALL', 'PLUMBER', 'TILE_INSTALLER'] as const).map(a => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.audiencePill, targetAudience === a && styles.audiencePillActive]}
                      onPress={() => setTargetAudience(a)}
                    >
                      <Text style={[styles.audiencePillText, targetAudience === a && styles.audiencePillTextActive]}>
                        {a === 'ALL' ? 'All Partners' : a === 'PLUMBER' ? 'Plumbers' : 'Tile Artisans'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.inputLabel, { marginTop: 12 }]}>Message Content *</Text>
                <TextInput
                  style={[styles.textInput, { height: 90, textAlignVertical: 'top' }]}
                  placeholder="Type push message delivered to craftsman mobile notification feeds..."
                  value={broadcastMessage}
                  onChangeText={setBroadcastMessage}
                  multiline
                  numberOfLines={4}
                />

                <TouchableOpacity
                  style={styles.broadcastBtn}
                  onPress={handleSendBroadcast}
                  disabled={sendingBroadcast}
                  activeOpacity={0.8}
                >
                  {sendingBroadcast ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Send size={16} color="#FFFFFF" />
                      <Text style={styles.broadcastBtnText}>Broadcast Message Now</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* History */}
              <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Recent Announcements</Text>
              {broadcastHistory.length === 0 ? (
                <View style={styles.emptyBroadcast}>
                  <Image
                    source={require('../../../assets/state_no_notifications.png')}
                    style={styles.emptyBellImg}
                    resizeMode="contain"
                  />
                  <Text style={styles.emptyTitle}>No Broadcasts Yet</Text>
                  <Text style={styles.emptySub}>Broadcasted push announcements will appear here.</Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {broadcastHistory.map((item: any) => (
                    <View key={item.id} style={styles.historyCard}>
                      <View style={styles.historyTop}>
                        <Text style={styles.historyTitle}>{item.title}</Text>
                        <View style={styles.audienceTag}>
                          <Text style={styles.audienceTagText}>{item.targetAudience || 'ALL'}</Text>
                        </View>
                      </View>
                      <Text style={styles.historyMsg}>{item.message}</Text>
                      <Text style={styles.historyDate}>
                        {new Date(item.createdAt).toLocaleString('en-IN')}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ======================================================== */}
          {/* SUBTAB 3: IMMUTABLE AUDIT TRAIL */}
          {/* ======================================================== */}
          {activeSubTab === 'AUDIT' && (
            <View>
              <Text style={styles.sectionTitle}>Compliance & Audit Log</Text>
              <Text style={styles.sectionSub}>
                Cryptographically tracked administrative operations and system state changes.
              </Text>

              {auditLogs.length === 0 ? (
                <View style={styles.emptySection}>
                  <ShieldCheck size={36} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>Zero Audit Anomalies</Text>
                  <Text style={styles.emptySub}>All audit records are verified and synchronized.</Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {auditLogs.slice(0, 30).map((log: any) => (
                    <TouchableOpacity
                      key={log.id}
                      style={styles.auditCard}
                      onPress={() => setSelectedAuditLog(log)}
                      activeOpacity={0.8}
                    >
                      <View style={styles.auditTop}>
                        <View style={styles.actionBadge}>
                          <Text style={styles.actionBadgeText}>{log.action || 'SYSTEM_ACTION'}</Text>
                        </View>
                        <Text style={styles.auditTime}>
                          {log.createdAt ? new Date(log.createdAt).toLocaleTimeString('en-IN') : ''}
                        </Text>
                      </View>

                      <Text style={styles.auditActor}>
                        Actor: <Text style={{ fontWeight: '700', color: '#0F172A' }}>{log.admin?.fullName || log.actor?.fullName || log.adminId || log.actorId || 'System'}</Text>
                      </Text>

                      <View style={styles.auditBottom}>
                        <Text style={styles.auditEntity}>
                          Entity: {log.entityType} ({log.entityId ? log.entityId.substring(0, 8) : 'Global'})
                        </Text>
                        <Text style={styles.auditIp}>{log.ipAddress || '127.0.0.1'}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ======================================================== */}
          {/* SUBTAB 4: SYSTEM SETTINGS */}
          {/* ======================================================== */}
          {activeSubTab === 'SETTINGS' && (
            <View>
              {/* Redemption Window Configuration */}
              <Text style={styles.sectionTitle}>Cashback Redemption Window</Text>
              <View style={styles.settingsCard}>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingHeading}>Enable Withdrawals</Text>
                    <Text style={styles.settingDesc}>
                      Controls whether plumbers and tile installers can submit cash payout requests.
                    </Text>
                  </View>
                  <Switch
                    value={isRedemptionOpen}
                    onValueChange={setIsRedemptionOpen}
                    trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                    thumbColor={isRedemptionOpen ? '#16A34A' : '#F1F5F9'}
                  />
                </View>

                <View style={styles.settingInputWrap}>
                  <Text style={styles.inputLabel}>Minimum Claim Amount (Points) *</Text>
                  <TextInput
                    style={styles.textInput}
                    value={minRedemptionAmt}
                    onChangeText={setMinRedemptionAmt}
                    placeholder="e.g. 500"
                    keyboardType="numeric"
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Start Date (YYYY-MM-DD)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={startDate}
                      onChangeText={setStartDate}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Start Time (HH:MM)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={startTime}
                      onChangeText={setStartTime}
                      placeholder="09:00"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>End Date (YYYY-MM-DD)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={endDate}
                      onChangeText={setEndDate}
                      placeholder="YYYY-MM-DD"
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>End Time (HH:MM)</Text>
                    <TextInput
                      style={styles.textInput}
                      value={endTime}
                      onChangeText={setEndTime}
                      placeholder="18:00"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={styles.settingInputWrap}>
                  <Text style={styles.inputLabel}>Status Message to Craftsmen</Text>
                  <TextInput
                    style={styles.textInput}
                    value={redemptionMsg}
                    onChangeText={setRedemptionMsg}
                    placeholder="e.g. Open for weekly disbursements"
                  />
                </View>

                <TouchableOpacity
                  style={styles.saveSettingsBtn}
                  onPress={handleSaveRedemption}
                  disabled={savingSettings}
                >
                  {savingSettings ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveSettingsBtnText}>Save Redemption Window Rules</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* GST Rules Management */}
              <View style={[styles.headerWithAction, { marginTop: 24 }]}>
                <Text style={styles.sectionTitle}>GST Deduction Rules</Text>
                <TouchableOpacity
                  style={styles.addRuleBtn}
                  onPress={() => setShowAddGstModal(true)}
                >
                  <Text style={styles.addRuleBtnText}>+ Add GST Rule</Text>
                </TouchableOpacity>
              </View>

              <View style={{ gap: 8 }}>
                {gstRules.map((rule: any) => (
                  <View key={rule.id} style={styles.gstRuleCard}>
                    <View>
                      <Text style={styles.gstRateText}>{rule.ratePercentage}% GST</Text>
                      <Text style={styles.gstDescText}>{rule.description || 'Standard Tax Bracket'}</Text>
                    </View>
                    {rule.isDefault && (
                      <View style={styles.defaultChip}>
                        <Text style={styles.defaultChipText}>DEFAULT</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Rate Adjustment Modal */}
      <Modal visible={!!rateModalProfession} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Adjust {rateModalProfession} Rate</Text>
              <TouchableOpacity onPress={() => setRateModalProfession(null)}>
                <X size={20} color="#475569" />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={styles.inputLabel}>New Incentive Rate (%) *</Text>
              <TextInput
                style={styles.textInput}
                value={newRatePercent}
                onChangeText={setNewRatePercent}
                placeholder="e.g. 0.55"
                keyboardType="numeric"
              />
              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setRateModalProfession(null)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={handleSaveRate}
                  disabled={savingRate}
                >
                  {savingRate ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.confirmBtnText}>Save New Rate</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add GST Modal */}
      <Modal visible={showAddGstModal} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add GST Deduction Rule</Text>
              <TouchableOpacity onPress={() => setShowAddGstModal(false)}>
                <X size={20} color="#475569" />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 16 }}>
              <Text style={styles.inputLabel}>Rate Percentage (%) *</Text>
              <TextInput
                style={styles.textInput}
                value={newGstRate}
                onChangeText={setNewGstRate}
                placeholder="e.g. 18"
                keyboardType="numeric"
              />
              <Text style={[styles.inputLabel, { marginTop: 10 }]}>Description</Text>
              <TextInput
                style={styles.textInput}
                value={newGstDesc}
                onChangeText={setNewGstDesc}
                placeholder="e.g. 18% Standard GST Goods"
              />
              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setShowAddGstModal(false)}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={handleAddGstRule}
                >
                  <Text style={styles.confirmBtnText}>Create Rule</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Audit Detail Modal */}
      <Modal visible={!!selectedAuditLog} animationType="fade" transparent>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalContainer, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Audit Event Details</Text>
              <TouchableOpacity onPress={() => setSelectedAuditLog(null)}>
                <X size={20} color="#475569" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 16 }}>
              <Text style={styles.auditJsonTitle}>Action: {selectedAuditLog?.action}</Text>
              <Text style={styles.auditJsonTitle}>
                Actor: {selectedAuditLog?.admin?.fullName || selectedAuditLog?.actor?.fullName || selectedAuditLog?.admin?.mobile || 'System'} ({selectedAuditLog?.adminId || selectedAuditLog?.actorId || 'N/A'})
              </Text>
              <Text style={styles.auditJsonTitle}>Time: {selectedAuditLog?.createdAt}</Text>
              <View style={styles.jsonBox}>
                <Text style={styles.jsonText}>
                  {JSON.stringify(selectedAuditLog?.details || selectedAuditLog, null, 2)}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  subTabBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 8,
  },
  subTabScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  subTabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  subTabItemActive: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  subTabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  subTabLabelActive: {
    color: '#DC2626',
    fontWeight: '800',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 8,
  },
  contentScroll: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 10,
  },
  sectionSub: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
  },
  ruleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  ruleCardBlue: {
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
  },
  ruleCardOrange: {
    borderColor: '#FED7AA',
    backgroundColor: '#FFF7ED',
  },
  ruleCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  ruleTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  ruleSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  ruleRate: {
    fontSize: 22,
    fontWeight: '900',
  },
  ruleCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    paddingTop: 10,
  },
  ruleMeta: {
    fontSize: 11,
    color: '#64748B',
  },
  ruleEditBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#93C5FD',
    backgroundColor: '#FFFFFF',
  },
  ruleEditBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  ledgerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  ledgerBox: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  ledgerLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  ledgerValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0F172A',
    marginTop: 4,
  },
  composerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
  },
  audienceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  audiencePill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  audiencePillActive: {
    backgroundColor: '#DC2626',
  },
  audiencePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  audiencePillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  broadcastBtn: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 10,
    marginTop: 16,
  },
  broadcastBtnText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyBroadcast: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBellImg: {
    width: 100,
    height: 100,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  historyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  audienceTag: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  audienceTagText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#DC2626',
  },
  historyMsg: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
    marginVertical: 4,
  },
  historyDate: {
    fontSize: 10.5,
    color: '#94A3B8',
  },
  emptySection: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  auditCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  auditTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  actionBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  actionBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  auditTime: {
    fontSize: 11,
    color: '#94A3B8',
  },
  auditActor: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  auditBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
    paddingTop: 6,
  },
  auditEntity: {
    fontSize: 11,
    color: '#64748B',
  },
  auditIp: {
    fontSize: 11,
    color: '#94A3B8',
  },
  settingsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  settingHeading: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  settingDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    paddingRight: 10,
  },
  settingInputWrap: {
    marginTop: 12,
  },
  saveSettingsBtn: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  saveSettingsBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  headerWithAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  addRuleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  addRuleBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  gstRuleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gstRateText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  gstDescText: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },
  defaultChip: {
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  defaultChipText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#16A34A',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  confirmBtn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  auditJsonTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 4,
  },
  jsonBox: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  jsonText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
