import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Handle, NodeResizer, Position } from 'reactflow';

import { isConnectableGroupType } from '../modeling/diagramTypes.js';

export default function GroupNode({ data, selected }) {
  const theme = useTheme();
  const title = data?.attributes?.name ?? data?.title ?? 'Group';
  const collapsed = Boolean(data?.__collapsed);
  const summary = data?.__collapsedIssueSummary;
  const errorCount = summary?.ERROR ?? 0;
  const warningCount = summary?.WARNING ?? 0;
  const hasIssues = (errorCount + warningCount + (summary?.INFO ?? 0)) > 0;

  const connectMode = data?.__connectMode;
  const connectActive = Boolean(connectMode?.active);
  const connectAllowed = Boolean(connectMode?.allowedTarget);
  const connectSource = Boolean(connectMode?.isSource);
  const connectable = isConnectableGroupType(data?.groupTypeId);

  const handleColor = selected || (connectActive && (connectAllowed || connectSource)) ? theme.palette.primary.main : theme.palette.divider;

  const indicatorColor = errorCount > 0 ? theme.palette.error.main : warningCount > 0 ? theme.palette.warning.main : theme.palette.text.secondary;

  return (
    <Box
      sx={{
        position: 'relative',
        height: '100%',
        width: '100%',
        borderRadius: 1,
        border: `1px solid ${selected || (connectActive && (connectAllowed || connectSource)) ? theme.palette.primary.main : theme.palette.divider}`,
        backgroundColor: theme.palette.background.default,
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: 6,
          left: 6,
          px: 0.75,
          py: 0.25,
          borderRadius: 0.5,
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" sx={{ fontWeight: 650, letterSpacing: 0.8, textTransform: 'uppercase', color: 'text.secondary' }}>
            {collapsed ? `${title} (collapsed)` : title}
          </Typography>
          {collapsed && hasIssues ? (
            <Box
              sx={{
                px: 0.5,
                py: 0.125,
                borderRadius: 0.5,
                border: `1px solid ${theme.palette.divider}`,
                backgroundColor: theme.palette.background.default
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 700, color: indicatorColor, lineHeight: 1.1 }}>
                {errorCount > 0 ? `${errorCount}E` : `${warningCount}W`}
              </Typography>
            </Box>
          ) : null}
        </Box>
      </Box>

      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        lineStyle={{ stroke: theme.palette.primary.main, strokeWidth: 1 }}
        handleStyle={{ fill: theme.palette.primary.main, width: 6, height: 6 }}
      />

      {connectable ? (
        <>
          <Handle type="target" position={Position.Top} style={{ background: handleColor, width: 6, height: 6 }} />
          <Handle type="source" position={Position.Bottom} style={{ background: handleColor, width: 6, height: 6 }} />
          <Handle type="source" position={Position.Right} style={{ background: handleColor, width: 6, height: 6 }} />
          <Handle type="target" position={Position.Left} style={{ background: handleColor, width: 6, height: 6 }} />
        </>
      ) : null}
    </Box>
  );
}
