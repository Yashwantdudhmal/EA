import React from 'react';
import { Box, Typography } from '@mui/material';
import { Handle, NodeResizer, Position } from 'reactflow';

export function GenericNode({ data, selected }) {
  return (
    <Box
      sx={{
        position: 'relative',
        height: '100%',
        width: '100%',
        backgroundColor: (theme) => theme.palette.background.paper,
        border: (theme) => `2px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
        borderRadius: 2,
        boxShadow: (theme) => `0 4px 12px ${theme.palette.common.black}33`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 1.5
      }}
    >
      <Typography
        variant="body2"
        sx={{
          color: (theme) => theme.palette.text.primary,
          fontWeight: 600,
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: 0.8
        }}
      >
        {data?.label ?? 'Node'}
      </Typography>

      <NodeResizer
        minWidth={120}
        minHeight={80}
        lineStyle={{ stroke: '#6b8cff', strokeWidth: 1.5 }}
        handleStyle={{ fill: '#6b8cff' }}
      />

      <Handle type="target" position={Position.Top} style={{ background: '#6b8cff' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#6b8cff' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#6b8cff' }} />
      <Handle type="target" position={Position.Left} style={{ background: '#6b8cff' }} />
    </Box>
  );
}

export default GenericNode;
