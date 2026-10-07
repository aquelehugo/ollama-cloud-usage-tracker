/*
    SPDX-License-Identifier: MIT

    Full representation — the popup that opens when the widget is
    clicked. Mirrors the GNOME extension's popup menu: header with last
    update + cookie source, pace-coloured quota bars for the session
    (5h) and weekly (7d) windows with exact percentages and reset
    countdowns, an error state, and Refresh / Open settings buttons.
*/

import QtQuick 2.15
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15 as QQC2

import org.kde.plasma.core 2.1 as PlasmaCore
import org.kde.plasma.components 3.0 as PlasmaComponents3
import org.kde.kirigami 2.20 as Kirigami

import "logic.js" as Logic

Item {
    id: fullRoot

    property var applet

    readonly property var d: applet.usageData

    implicitWidth: PlasmaCore.Units.gridUnit * 24
    implicitHeight: content.implicitHeight + PlasmaCore.Units.gridUnit * 2
    Layout.minimumWidth: implicitWidth
    Layout.maximumWidth: implicitWidth
    Layout.minimumHeight: implicitHeight
    Layout.maximumHeight: implicitHeight

    // One quota row: title, pace-coloured bar, exact percentage and a
    // reset countdown — visually matching the GNOME popup's rows.
    component QuotaRow: RowLayout {
        id: quotaRow

        property string title: ""
        property real pct: -1          // -1 = no data
        property string resetsAt: ""
        property int windowSec: 0

        readonly property string role: Logic.paceRole(pct, resetsAt, windowSec)
        readonly property color paceColor:
            role === "negative" ? Kirigami.Theme.negativeTextColor
            : role === "neutral" ? Kirigami.Theme.neutralTextColor
            : role === "positive" ? Kirigami.Theme.positiveTextColor
            : Kirigami.Theme.highlightedTextColor

        PlasmaComponents3.Label {
            text: quotaRow.title
            Layout.preferredWidth: PlasmaCore.Units.gridUnit * 7.5
        }

        Rectangle { // track
            Layout.fillWidth: true
            Layout.preferredHeight: Math.max(6, Math.round(PlasmaCore.Units.gridUnit / 3))
            radius: height / 2
            color: Kirigami.Theme.alternateBackgroundColor

            Rectangle { // fill
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                visible: quotaRow.pct >= 0
                width: parent.width * Math.max(0, Math.min(100, quotaRow.pct)) / 100
                radius: parent.radius
                color: quotaRow.paceColor

                Behavior on width {
                    NumberAnimation {
                        duration: PlasmaCore.Units.shortDuration
                        easing.type: Easing.OutCubic
                    }
                }
            }
        }

        PlasmaComponents3.Label {
            text: quotaRow.pct >= 0 ? quotaRow.pct.toFixed(1) + "%" : "—"
            Layout.preferredWidth: PlasmaCore.Units.gridUnit * 3
            horizontalAlignment: Text.AlignRight
            color: quotaRow.paceColor
        }

        PlasmaComponents3.Label {
            visible: quotaRow.pct >= 0 && quotaRow.resetsAt !== ""
            text: "⟳ " + Logic.formatCountdown(quotaRow.resetsAt)
            color: Kirigami.Theme.disabledTextColor
        }
    }

    ColumnLayout {
        id: content

        anchors.fill: parent
        anchors.margins: PlasmaCore.Units.gridUnit
        spacing: PlasmaCore.Units.smallSpacing

        // ── Header ───────────────────────────────────────────────────
        PlasmaComponents3.Label {
            text: "Ollama Cloud Usage"
            font.bold: true
            Layout.fillWidth: true
        }

        PlasmaComponents3.Label {
            visible: fullRoot.d != null
            text: fullRoot.d != null
                ? ("Last updated " + Logic.formatRelativeTime(fullRoot.d.fetched_at)
                   + "  ·  via "
                   + (fullRoot.d.browser ? fullRoot.d.browser : "unknown"))
                : ""
            color: Kirigami.Theme.disabledTextColor
            elide: Text.ElideRight
            Layout.fillWidth: true
        }

        // ── Error state (GNOME parity: message + hint, red) ──────────
        PlasmaComponents3.Label {
            visible: fullRoot.applet.errorMessage !== ""
            text: fullRoot.applet.errorMessage
                  + (fullRoot.applet.errorHint !== ""
                     ? "\n" + fullRoot.applet.errorHint
                     : "")
            color: Kirigami.Theme.negativeTextColor
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        // ── Quota rows ───────────────────────────────────────────────
        QuotaRow {
            title: "Session (5h)"
            pct: (fullRoot.d != null && fullRoot.d.session_pct != null)
                 ? fullRoot.d.session_pct : -1
            resetsAt: (fullRoot.d != null && fullRoot.d.session_resets_at != null)
                      ? fullRoot.d.session_resets_at : ""
            windowSec: Logic.SESSION_WINDOW_SEC
        }

        QuotaRow {
            title: "Weekly  (7d)"
            pct: (fullRoot.d != null && fullRoot.d.weekly_pct != null)
                 ? fullRoot.d.weekly_pct : -1
            resetsAt: (fullRoot.d != null && fullRoot.d.weekly_resets_at != null)
                      ? fullRoot.d.weekly_resets_at : ""
            windowSec: Logic.WEEKLY_WINDOW_SEC
        }

        Rectangle { // separator
            Layout.fillWidth: true
            Layout.topMargin: PlasmaCore.Units.smallSpacing
            implicitHeight: 1
            color: Kirigami.Theme.alternateBackgroundColor
        }

        // ── Actions (GNOME menu parity) ──────────────────────────────
        RowLayout {
            Layout.alignment: Qt.AlignRight
            spacing: PlasmaCore.Units.smallSpacing

            QQC2.Button {
                text: "Refresh now"
                icon.name: "view-refresh"
                enabled: !fullRoot.applet.busy
                onClicked: fullRoot.applet.refreshNow()
            }

            QQC2.Button {
                text: "Open ollama.com/settings"
                icon.name: "internet-web-browser"
                onClicked: fullRoot.applet.openSettings()
            }
        }
    }
}