import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Handle, NodeResizer, Position } from 'reactflow';

function resolveToken(theme, token, fallback) {
  if (!token) return fallback;
  switch (token) {
    case 'primary':
      return theme.palette.primary.main;
    case 'secondary':
      return theme.palette.secondary.main;
    case 'divider':
      return theme.palette.divider;
    case 'paper':
      return theme.palette.background.paper;
    default:
      return fallback;
  }
}

export function GenericNode({ data, selected }) {
  const theme = useTheme();
  const icon = (data?.iconKey ?? data?.icon ?? '').trim();
  const derived = data?.__derivedVisual;
  const fillToken = derived?.fill ?? 'paper';
  const borderToken = derived?.border ?? 'divider';
  const accent = theme.palette.primary.main;
  const impact = data?.__impact;
  const impactActive = Boolean(impact?.active);
  const impacted = Boolean(impact?.impacted);
  const impactStart = Boolean(impact?.start);
  const badgeFi = Boolean(impact?.indicators?.highFanIn);
  const badgeFo = Boolean(impact?.indicators?.highFanOut);
  const badgeCh = Boolean(impact?.indicators?.chain);
  const title = data?.title ?? data?.attributes?.name ?? data?.label ?? 'Component';
  const handleColor = selected ? accent : theme.palette.divider;
  const isEaCore = data?.metadata?.source === 'EA_CORE';

  const connectMode = data?.__connectMode;
  const connectActive = Boolean(connectMode?.active);
  const connectAllowed = Boolean(connectMode?.allowedTarget);
  const connectSource = Boolean(connectMode?.isSource);

  const showBadges = impactActive && impacted && (badgeFi || badgeFo || badgeCh || impactStart);
  const borderColor = (theme) => {
    if (selected) return theme.palette.primary.main;
    if (impactActive && impacted) return theme.palette.primary.main;
    if (connectActive && (connectAllowed || connectSource)) return theme.palette.primary.main;
    return resolveToken(theme, borderToken, theme.palette.divider);
  };

  return (
    <Box
      sx={{
        position: 'relative',
        height: '100%',
        width: '100%',
        backgroundColor: (theme) => resolveToken(theme, fillToken, theme.palette.background.paper),
        border: (theme) => `1px solid ${borderColor(theme)}`,
        borderStyle: isEaCore ? 'dashed' : 'solid',
        borderRadius: 1,
        boxShadow: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        padding: 0.75,
        outline: (theme) => ((selected || (impactActive && impacted) || (connectActive && (connectAllowed || connectSource))) ? `1px solid ${theme.palette.primary.main}` : '1px solid transparent'),
        outlineOffset: 1
      }}
    >
      {showBadges ? (
        <Box
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            display: 'flex',
            gap: 0.5,
            alignItems: 'center',
            pointerEvents: 'none'
          }}
        >
          {impactStart ? (
            <Box
              sx={{
                px: 0.5,
                py: 0.125,
                borderRadius: 0.5,
                border: (theme) => `1px solid ${theme.palette.divider}`,
                backgroundColor: (theme) => theme.palette.background.default
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 750, color: 'text.secondary', lineHeight: 1.1 }}>
                START
              </Typography>
            </Box>
          ) : null}
          {badgeFi ? (
            <Box
              sx={{
                px: 0.5,
                py: 0.125,
                borderRadius: 0.5,
                border: (theme) => `1px solid ${theme.palette.divider}`,
                backgroundColor: (theme) => theme.palette.background.default
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 750, color: 'text.secondary', lineHeight: 1.1 }}>
                FI
              </Typography>
            </Box>
          ) : null}
          {badgeFo ? (
            <Box
              sx={{
                px: 0.5,
                py: 0.125,
                borderRadius: 0.5,
                border: (theme) => `1px solid ${theme.palette.divider}`,
                backgroundColor: (theme) => theme.palette.background.default
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 750, color: 'text.secondary', lineHeight: 1.1 }}>
                FO
              </Typography>
            </Box>
          ) : null}
          {badgeCh ? (
            <Box
              sx={{
                px: 0.5,
                py: 0.125,
                borderRadius: 0.5,
                border: (theme) => `1px solid ${theme.palette.divider}`,
                backgroundColor: (theme) => theme.palette.background.default
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 750, color: 'text.secondary', lineHeight: 1.1 }}>
                CH
              </Typography>
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" sx={{ width: '100%' }}>
        <Box
          sx={{
            height: 20,
            width: 20,
            borderRadius: 0.5,
            flex: '0 0 auto',
            display: 'grid',
            placeItems: 'center',
            backgroundColor: (theme) => theme.palette.background.default,
            border: (theme) => `1px solid ${theme.palette.divider}`
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', lineHeight: 1 }}>
            {icon ? icon.slice(0, 2).toUpperCase() : '◻'}
          </Typography>
        </Box>

        <Typography
          variant="body2"
          sx={{
            color: (theme) => theme.palette.text.primary,
            fontWeight: 650,
            textAlign: 'center',
            letterSpacing: 0.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {title}
        </Typography>
      </Stack>

      {data?.attributes?.description || data?.description ? (
        <Typography
          variant="caption"
          sx={{
            color: 'text.secondary',
            textAlign: 'center',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {data?.attributes?.description ?? data?.description}
        </Typography>
      ) : null}

      <NodeResizer
        isVisible={selected}
        minWidth={110}
        minHeight={64}
        lineStyle={{ stroke: accent, strokeWidth: 1 }}
        handleStyle={{ fill: accent, width: 6, height: 6 }}
      />

      <Handle type="target" position={Position.Top} style={{ background: handleColor, width: 6, height: 6 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: handleColor, width: 6, height: 6 }} />
      <Handle type="source" position={Position.Right} style={{ background: handleColor, width: 6, height: 6 }} />
      <Handle type="target" position={Position.Left} style={{ background: handleColor, width: 6, height: 6 }} />
    </Box>
  );
}

export default GenericNode;
